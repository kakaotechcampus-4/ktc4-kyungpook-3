"""Whisper large-v3 LoRA 학습. S3 의 FLAC·라벨을 내려받아 돌리고 지표와 체크포인트를 S3 에 남긴다."""
import argparse, json, math, os, pathlib, random, re, time
from concurrent.futures import ThreadPoolExecutor

import boto3, soundfile as sf, torch
from peft import LoraConfig, PeftModel, get_peft_model
from rapidfuzz.distance import Levenshtein
from torch.utils.data import DataLoader, Dataset
from transformers import WhisperForConditionalGeneration, WhisperProcessor

from clean import clean

ap = argparse.ArgumentParser()
ap.add_argument("bucket")
ap.add_argument("--run", required=True)
ap.add_argument("--pilot", action="store_true")
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--lr", type=float, default=1e-4)
ap.add_argument("--epochs", type=float, default=3)
ap.add_argument("--max-hours", type=float, default=30)
ap.add_argument("--sets", default="ts2,ts3")
ap.add_argument("--adapter", help="이어서 학습할 S3 체크포인트 접두어")
args = ap.parse_args()

MODEL, SR, EVAL_N = "openai/whisper-large-v3", 16000, 1500
SETS = args.sets.split(",")
DATA = pathlib.Path("/data"); WORK = DATA / "run"; WORK.mkdir(parents=True, exist_ok=True)
OUT = f"aihub-464/lora/{args.run}"
s3 = boto3.client("s3", region_name="ap-northeast-2")
t0 = time.time()


def log(**kw):
    kw["t"] = round(time.time() - t0)
    line = json.dumps(kw, ensure_ascii=False)
    print(line, flush=True)
    with open(WORK / "metrics.jsonl", "a") as f: f.write(line + "\n")
    s3.upload_file(str(WORK / "metrics.jsonl"), args.bucket, f"{OUT}/metrics.jsonl")


def sync():
    keys = []
    for prefix in [f"aihub-464/{d}/{k}/" for d in SETS for k in ("flac", "labels")]:
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=args.bucket, Prefix=prefix):
            keys += [o["Key"] for o in page.get("Contents", [])]
    keys += [f"aihub-464/{d}/manifest.jsonl" for d in SETS]

    def get(key):
        path = DATA / key.removeprefix("aihub-464/")
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists(): s3.download_file(args.bucket, key, str(path))

    with ThreadPoolExecutor(16) as pool: list(pool.map(get, keys))


def rows():
    train, val = [], []
    for d in SETS:
        for line in open(DATA / d / "manifest.jsonl"):
            m = json.loads(line)
            path = str(DATA / d / "flac" / m["split"] / f"{m['title']}.flac")
            for u in json.load(open(DATA / d / "labels" / f"{m['title']}.json"))["utterance"]:
                s, e, text = float(u["start"]), float(u["end"]), clean(u["form"])
                if text and 0.5 <= e - s <= 30:
                    (train if m["split"] == "train" else val).append((path, s, e, text))
    random.Random(0).shuffle(val)
    return train, val[:EVAL_N]


class Utts(Dataset):
    def __init__(self, items, processor): self.items, self.p = items, processor
    def __len__(self): return len(self.items)

    def __getitem__(self, i):
        path, s, e, text = self.items[i]
        audio, _ = sf.read(path, start=int(s * SR), frames=int((e - s) * SR), dtype="float32")
        feats = self.p.feature_extractor(audio, sampling_rate=SR, return_tensors="np").input_features[0]
        return torch.from_numpy(feats), self.p.tokenizer(text, truncation=True, max_length=448).input_ids[1:], text


def collate(batch):
    n = max(len(b[1]) for b in batch)
    labels = torch.tensor([b[1] + [-100] * (n - len(b[1])) for b in batch])
    return torch.stack([b[0] for b in batch]), labels, [b[2] for b in batch]


def nospace(text):
    return re.sub(r"\s+", "", re.sub(r"[^\w\s]", " ", text).lower())


def loader(items, batch, shuffle):
    return DataLoader(Utts(items, processor), batch, shuffle=shuffle, num_workers=4, collate_fn=collate,
                      drop_last=shuffle, persistent_workers=False, pin_memory=True)


@torch.no_grad()
def evaluate(val):
    model.eval(); dist = chars = 0
    for x, _, refs in loader(val, 32, False):
        with torch.autocast("cuda", dtype=torch.bfloat16):
            ids = model.generate(input_features=x.cuda(), language="ko", task="transcribe", max_new_tokens=220)
        for ref, hyp in zip(refs, processor.batch_decode(ids, skip_special_tokens=True)):
            r, h = nospace(ref), nospace(hyp); dist += Levenshtein.distance(r, h); chars += len(r)
    model.train()
    return round(100 * dist / chars, 3)


def save(step):
    d = WORK / f"ckpt-{step}"; model.save_pretrained(d)
    for f in d.iterdir(): s3.upload_file(str(f), args.bucket, f"{OUT}/ckpt-{step}/{f.name}")


def step_once(x, y, opt, lr):
    for g in opt.param_groups: g["lr"] = lr
    with torch.autocast("cuda", dtype=torch.bfloat16):
        loss = model(input_features=x.cuda(non_blocking=True), labels=y.cuda(non_blocking=True)).loss
    loss.backward()
    torch.nn.utils.clip_grad_norm_(trainable, 1.0)
    opt.step(); opt.zero_grad(set_to_none=True)
    return loss.item()


log(event="sync-start"); sync(); log(event="sync-done")
processor = WhisperProcessor.from_pretrained(MODEL, language="ko", task="transcribe")
train, val = rows()
log(event="data", train=len(train), val=len(val), train_h=round(sum(r[2] - r[1] for r in train) / 3600, 1))
base = WhisperForConditionalGeneration.from_pretrained(MODEL)
base.generation_config.forced_decoder_ids = None; base.config.use_cache = False
if args.adapter:
    files = s3.list_objects_v2(Bucket=args.bucket, Prefix=args.adapter)["Contents"]
    local = WORK / "resume"; local.mkdir(exist_ok=True)
    for o in files: s3.download_file(args.bucket, o["Key"], str(local / pathlib.Path(o["Key"]).name))
    model = PeftModel.from_pretrained(base, local, is_trainable=True)
else:
    model = get_peft_model(base, LoraConfig(r=32, lora_alpha=64, lora_dropout=0.05, target_modules=["q_proj", "v_proj"]))
model.cuda().train()
model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
trainable = [p for p in model.parameters() if p.requires_grad]
log(event="model", trainable=sum(p.numel() for p in trainable), gpu=torch.cuda.get_device_name())
opt = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=0.0)

if not args.adapter and not args.pilot:
    log(event="eval", step=0, cer=evaluate(val))

if args.pilot:
    args.batch = None
    for bs in (32, 24, 16, 8):
        try:
            it = iter(loader(train, bs, True)); next(it); start, n = time.time(), 0
            for x, y, _ in it:
                step_once(x, y, opt, 1e-5); n += 1
                if n == 30: break
            sec = (time.time() - start) / n
            log(event="bench", batch=bs, sec_per_step=round(sec, 3), utts_per_sec=round(bs / sec, 1),
                mem_gb=round(torch.cuda.max_memory_allocated() / 2**30, 1))
            it = None; args.batch = bs; break
        except torch.cuda.OutOfMemoryError as e:
            message = str(e)[:150]
        else:
            continue
        x = y = it = None
        opt.zero_grad(set_to_none=True); torch.cuda.empty_cache(); log(event="oom", batch=bs, message=message)
    assert args.batch, "모든 배치에서 메모리 부족"

steps_per_epoch = len(train) // args.batch
total = 400 if args.pilot else int(args.epochs * steps_per_epoch)
every = 400 if args.pilot else max(steps_per_epoch // 4, 1)
warmup = 50 if args.pilot else 500
log(event="plan", batch=args.batch, steps_per_epoch=steps_per_epoch, total=total, every=every)

step, best, bad, losses, stop = 0, math.inf, 0, [], False
tick = time.time()
while step < total and not stop:
    for x, y, _ in loader(train, args.batch, True):
        step += 1
        decay = max(0.0, (total - step) / max(total - warmup, 1))
        losses.append(step_once(x, y, opt, args.lr * min(step / warmup, decay)))
        if step % 50 == 0:
            log(event="train", step=step, loss=round(sum(losses) / len(losses), 4),
                sec_per_step=round((time.time() - tick) / 50, 3)); losses, tick = [], time.time()
        timeout = (time.time() - t0) / 3600 > args.max_hours
        if step % every == 0 or step >= total or timeout:
            cer = evaluate(val); save(step); log(event="eval", step=step, cer=cer); tick = time.time()
            best, bad = (cer, 0) if cer < best else (best, bad + 1)
            stop = bad >= 3 or timeout or step >= total
            if stop: break
log(event="done", step=step, best_cer=best, peak_gb=round(torch.cuda.max_memory_allocated() / 2**30, 1))
