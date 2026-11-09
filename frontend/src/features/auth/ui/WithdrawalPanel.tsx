import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  SESSION_QUERY_KEY,
  captureSession,
  fetchWithdrawalPlan,
  fetchWithdrawalReceipt,
  sessionQueryOptions,
  withdrawAccount,
} from '@/entities/user'
import { findPushSubscription } from '@/entities/notification'
import { ApiError } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { clearUserScope } from '../lib/userScope'
import {
  clearWithdrawalProof,
  createWithdrawalKey,
  readWithdrawalProof,
  saveWithdrawalProof,
} from '../model/withdrawalProof'
import type { WithdrawalProof } from '../model/withdrawalProof'

const COPY = 'text-body leading-relaxed text-sub'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4'

export function WithdrawalPanel() {
  const queryClient = useQueryClient()
  const [proof, setProof] = useState<WithdrawalProof | null>(readWithdrawalProof)
  const [confirmed, setConfirmed] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const session = useQuery({ ...sessionQueryOptions(), enabled: proof?.kind !== 'receipt' })
  const plan = useQuery({
    queryKey: ['withdrawal-plan'],
    queryFn: ({ signal }) => fetchWithdrawalPlan(signal),
    enabled: proof === null && session.data != null,
    staleTime: 0,
  })
  const receipt = useQuery({
    queryKey: ['withdrawal-receipt', proof?.kind === 'receipt' ? proof.id : null],
    queryFn: ({ signal }) => {
      if (proof?.kind !== 'receipt') throw new Error('Withdrawal receipt is not available')
      return fetchWithdrawalReceipt(proof.id, proof.key, signal)
    },
    enabled: proof?.kind === 'receipt',
    refetchInterval: (query) =>
      query.state.data?.cleanup_status === 'complete' || query.state.error ? false : 3000,
  })
  const command = useMutation({
    mutationFn: async ({ key, accountId }: { key: string; accountId: string }) => {
      const isCurrent = captureSession()
      saveWithdrawalProof({ kind: 'request', key, accountId })
      return { receipt: await withdrawAccount(key, accountId), isCurrent }
    },
    onSuccess: async ({ receipt: result, isCurrent }, { key }) => {
      const next: WithdrawalProof = { kind: 'receipt', key, id: result.withdrawal_id }
      // 계정은 이미 삭제됐다. 영수증 저장 실패로 이전 계정 화면을 다시 표시하지 않는다.
      try {
        saveWithdrawalProof(next)
      } catch {
        setStorageError(true)
      }
      if (isCurrent()) {
        queryClient.setQueryData(SESSION_QUERY_KEY, null)
        await clearUserScope(queryClient)
        const ended = captureSession()
        void findPushSubscription()
          .then((subscription) => (ended() ? subscription?.unsubscribe() : undefined))
          .catch(() => undefined)
      }
      queryClient.setQueryData(['withdrawal-receipt', result.withdrawal_id], result)
      setProof(next)
    },
    onError: (error, { key, accountId }) => {
      if (error instanceof ApiError && error.code === 'LAST_PM_REQUIRED') {
        clearWithdrawalProof()
        setProof(null)
        void plan.refetch()
      } else if (
        error instanceof ApiError &&
        error.kind === 'http' &&
        error.status >= 400 &&
        error.status < 500
      ) {
        clearWithdrawalProof()
        setProof(null)
      } else if (readWithdrawalProof() !== null) {
        setProof({ kind: 'request', key, accountId })
        void session.refetch()
      } else {
        setStorageError(true)
      }
    },
  })

  if (proof?.kind === 'receipt') {
    if (receipt.data === undefined) {
      return (
        <section className="flex flex-col gap-20" aria-label="탈퇴 요청 확인">
          <h2 className="text-heading font-semibold text-ink">탈퇴 요청을 확인하고 있어요</h2>
          {receipt.isError ? (
            <div role="alert" className={COPY}>
              이 요청의 처리 상태를 확인하지 못했어요. 확인되지 않은 상태를 탈퇴 완료로 표시하지
              않아요.<Button onClick={() => void receipt.refetch()}>정리 상태 다시 확인</Button>
            </div>
          ) : (
            <p className={COPY}>저장된 요청 정보로 서버의 처리 결과를 확인하고 있어요.</p>
          )}
          <Link className={LINK} to={paths.login()} onClick={clearWithdrawalProof}>
            로그인 화면
          </Link>
        </section>
      )
    }
    const complete = receipt.data?.cleanup_status === 'complete'
    return (
      <section className="flex flex-col gap-20" aria-label="탈퇴 처리 상태">
        <h2 className="text-heading font-semibold text-ink">
          {complete ? '탈퇴 완료' : '개인정보 정리 중'}
        </h2>
        <p className={COPY}>
          이 탈퇴 요청의 계정과 로그인 세션은 삭제됐어요. 남아 있는 팀의 공동 기록에는 탈퇴한
          사용자로 표시돼요.
        </p>
        <p className={COPY}>
          {complete
            ? '개인정보와 삭제 대상 파일의 정리를 확인했어요.'
            : '파일과 AI 저장소의 정리가 끝났는지 확인 중이에요. 서버 연결이 늦어져도 계정은 다시 활성화되지 않아요.'}
        </p>
        {receipt.isError ? (
          <div role="alert" className={COPY}>
            정리 상태를 확인하지 못했어요. 계정 이용은 종료됐으며 다시 확인할 수 있어요.
            <Button onClick={() => void receipt.refetch()}>정리 상태 다시 확인</Button>
          </div>
        ) : null}
        {storageError ? (
          <p role="alert" className={COPY}>
            이 탭을 닫기 전에 정리 상태를 확인해 주세요. 브라우저에 확인 정보를 저장하지 못했어요.
          </p>
        ) : null}
        <p className={COPY}>
          같은 이메일이나 카카오로 바로 새 계정을 만들 수 있어요. 이전 팀에는 새 초대가 필요해요.
        </p>
        <Link className={LINK} to={paths.signup()} onClick={clearWithdrawalProof}>
          새 계정 만들기
        </Link>
        <Link className={LINK} to={paths.login()} onClick={clearWithdrawalProof}>
          로그인 화면
        </Link>
      </section>
    )
  }

  if (proof?.kind === 'request') {
    const otherAccount = session.data != null && session.data.user.id !== proof.accountId
    return (
      <section className="flex flex-col gap-20" aria-label="탈퇴 요청 확인">
        <h2 className="text-heading font-semibold text-ink">처리 결과를 확인해 주세요</h2>
        <p className={COPY}>
          응답을 받지 못해 탈퇴 여부를 확인하지 못했어요. 같은 요청으로 결과를 다시 확인하며
          중복으로 탈퇴 처리하지 않아요.
        </p>
        {otherAccount ? (
          <p role="alert" className={COPY}>
            다른 계정으로 로그인됐어요. 이전 요청으로 현재 계정을 탈퇴시키지 않아요.
          </p>
        ) : null}
        {session.isError ? (
          <p role="alert" className={COPY}>
            현재 로그인 계정을 확인하지 못했어요.
            <Button onClick={() => void session.refetch()}>계정 다시 확인</Button>
          </p>
        ) : null}
        <Button
          variant="primary"
          disabled={otherAccount || session.isPending || session.isError}
          loading={command.isPending}
          onClick={() => command.mutate(proof)}
        >
          처리 결과 다시 확인
        </Button>
        {otherAccount ? (
          <Button
            onClick={() => {
              clearWithdrawalProof()
              setProof(null)
            }}
          >
            현재 계정으로 돌아가기
          </Button>
        ) : null}
      </section>
    )
  }

  if (session.isPending) return <p className={COPY}>계정을 확인하고 있어요.</p>
  if (session.data === null)
    return (
      <Link className={LINK} to={paths.login(paths.withdrawal())}>
        로그인 후 탈퇴하기
      </Link>
    )
  if (session.isError || plan.isError) {
    return (
      <div role="alert" className={COPY}>
        탈퇴 조건을 확인하지 못했어요. 계정은 변경되지 않았어요.
        <Button onClick={() => void (session.isError ? session.refetch() : plan.refetch())}>
          다시 시도
        </Button>
      </div>
    )
  }
  if (plan.isPending) return <p className={COPY}>모든 팀의 탈퇴 조건을 확인하고 있어요.</p>
  const blocked = (plan.data?.blocked_workspace_ids.length ?? 0) > 0
  return (
    <div className="flex flex-col gap-20">
      <p className={COPY}>
        계정·로그인 세션·개인 연결 정보와 별칭을 삭제해요. 탈퇴를 취소하거나 이전 권한을 복구할 수
        없어요.
      </p>
      <p className={COPY}>
        다른 팀원이 있는 회의·태스크·메시지는 탈퇴한 사용자로 남아요. 혼자 남은 팀과 그 안의
        기록·파일은 삭제해요.
      </p>
      <ul className="flex flex-col gap-12">
        {plan.data?.workspaces.map((workspace) => (
          <li key={workspace.workspace_id} className={COPY}>
            <span className="font-semibold text-ink">{workspace.workspace_name}</span>
            {workspace.disposition === 'transfer_pm' ? (
              <p>
                마지막 PM이에요. 다른 로그인 팀원에게 PM 권한을 먼저 부여해 주세요.{' '}
                <Link className={LINK} to={paths.members(workspace.workspace_id)}>
                  팀에서 권한 이전하기
                </Link>
              </p>
            ) : workspace.disposition === 'delete' ? (
              ' · 혼자 남은 팀이므로 팀과 모든 기록을 삭제해요.'
            ) : (
              ' · 공동 기록을 익명으로 보존해요.'
            )}
          </li>
        ))}
      </ul>
      {blocked ? (
        <p role="alert" className={COPY}>
          PM 권한 이전이 필요한 팀이 있어요. 어느 팀도 아직 변경되지 않았어요.
        </p>
      ) : (
        <Checkbox
          checked={confirmed}
          onCheckedChange={(value) => setConfirmed(value === true)}
          disabled={command.isPending}
        >
          삭제 범위와 새 초대가 필요함을 확인했어요.
        </Checkbox>
      )}
      {command.isError ? (
        <p role="alert" className={COPY}>
          {command.error instanceof ApiError && command.error.code === 'LAST_PM_REQUIRED'
            ? 'PM 조건이 바뀌었어요. 권한 이전 후 다시 시도해 주세요.'
            : command.error instanceof ApiError &&
                command.error.code === 'WITHDRAWAL_ACCOUNT_CHANGED'
              ? '로그인 계정이 바뀌었어요. 페이지를 새로고침해 현재 계정을 확인해 주세요. 어떤 계정도 이 요청으로 삭제하지 않았어요.'
              : '탈퇴 요청이 거절됐어요. 계정은 변경되지 않았어요.'}
        </p>
      ) : null}
      {storageError ? (
        <p role="alert" className={COPY}>
          이 브라우저에 재시도 정보를 저장할 수 없어요. 저장 공간 설정을 확인한 뒤 다시 시도해
          주세요.
        </p>
      ) : null}
      <Button
        variant="primary"
        disabled={
          blocked ||
          !confirmed ||
          (command.error instanceof ApiError && command.error.code === 'WITHDRAWAL_ACCOUNT_CHANGED')
        }
        loading={command.isPending}
        onClick={() => {
          if (session.data)
            command.mutate({ key: createWithdrawalKey(), accountId: session.data.user.id })
        }}
      >
        계정 탈퇴하기
      </Button>
      <Link className={LINK} to={paths.workspaceSelect()}>
        돌아가기
      </Link>
    </div>
  )
}
