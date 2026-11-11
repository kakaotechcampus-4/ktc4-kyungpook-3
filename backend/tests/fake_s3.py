"""테스트용 가짜 S3 클라이언트. 실제 AWS 를 부르지 않고 dict 에 저장한다.

`fail_next` 에 메서드 이름을 넣으면 그 메서드가 다음 한 번 `ClientError` 를 낸다.
"""
import io

from botocore.exceptions import ClientError


class FakeS3:
    def __init__(self):
        # (bucket, key) -> {"body": bytes, "content_type": str | None}
        self.objects: dict[tuple[str, str], dict] = {}
        self.fail_next: str | None = None
        self.presign_calls: list[dict] = []

    def _maybe_fail(self, method: str) -> None:
        if self.fail_next == method:
            self.fail_next = None
            raise ClientError({"Error": {"Code": "500", "Message": "boom"}}, method)

    def put(self, bucket: str, key: str, body: bytes, content_type: str | None = None) -> None:
        self.objects[(bucket, key)] = {"body": body, "content_type": content_type}

    def keys(self, bucket: str) -> list[str]:
        return sorted(key for b, key in self.objects if b == bucket)

    def upload_fileobj(self, Fileobj, Bucket, Key, ExtraArgs=None):
        self._maybe_fail("upload_fileobj")
        self.put(Bucket, Key, Fileobj.read(), (ExtraArgs or {}).get("ContentType"))

    def head_object(self, Bucket, Key):
        self._maybe_fail("head_object")
        item = self.objects.get((Bucket, Key))
        if item is None:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"ContentLength": len(item["body"]), "ContentType": item["content_type"]}

    def get_object(self, Bucket, Key):
        self._maybe_fail("get_object")
        item = self.objects.get((Bucket, Key))
        if item is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        return {
            "Body": io.BytesIO(item["body"]),
            "ContentLength": len(item["body"]),
            "ContentType": item["content_type"],
        }

    def list_objects_v2(self, Bucket, Prefix="", ContinuationToken=None):
        self._maybe_fail("list_objects_v2")
        keys = sorted(key for b, key in self.objects if b == Bucket and key.startswith(Prefix))
        return {"Contents": [{"Key": key} for key in keys], "IsTruncated": False}

    def delete_objects(self, Bucket, Delete):
        self._maybe_fail("delete_objects")
        for entry in Delete["Objects"]:
            self.objects.pop((Bucket, entry["Key"]), None)
        return {"Deleted": Delete["Objects"]}

    def generate_presigned_url(self, ClientMethod, Params=None, ExpiresIn=3600):
        self.presign_calls.append({"ClientMethod": ClientMethod, "Params": Params, "ExpiresIn": ExpiresIn})
        return f"https://fake-s3.example/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"
