// 계정(역할)별로 볼 수 있는 화면 · 설명 (로그인 화면 · 관리 > 시스템 탭 · 내비가 함께 씀)
// 서버 권한(backend/app/api/security.py)과 같은 기준: 검토자는 열람만, 모의 훈련은 관리자만
import { useSyncExternalStore } from "react"
import { getSession, onAuthChange, type Role } from "@/lib/api"

export const PAGES: Record<Role, string[]> = {
  supervisor: ["/", "/setup", "/roam", "/log"],
  admin: ["/", "/setup", "/log", "/admin"], // 순회 · 결과 입력은 감독관만 (감독 화면은 보기만)
  auditor: ["/log", "/admin"],
}
export const HOME: Record<Role, "/" | "/log"> = { supervisor: "/", admin: "/", auditor: "/log" }

/** '/roam/3' 처럼 아래 주소도 같은 화면으로 봄 */
export const canSee = (role: Role, path: string) =>
  PAGES[role].some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)))

export const ROLE_DESC: Record<Role, string> = {
  supervisor: "교실에서 시험을 진행하는 사람. 감독, 순회, 수색 결과 입력",
  admin: "시험장 시스템과 장비 담당. 설정과 모의 훈련 (시험 중 기준값은 잠김)",
  auditor: "시험 후 이의 제기와 판정을 검토하는 제3자. 열람만 가능",
}

/** 순회 · 수색 결과 · 감독관 의견을 입력할 수 있는 역할 (서버 security.SUPERVISOR_ONLY 와 같음) */
export const canRecord = (role: Role) => role === "supervisor"

export function useSession() {
  return useSyncExternalStore(onAuthChange, getSession, getSession)
}
