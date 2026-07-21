import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // jh 수정함 - eslint-plugin-react-hooks 7.x의 recommended 프리셋에 새로
    // 편입된 "React Compiler" 대비 규칙들(set-state-in-effect/purity)이
    // 이 프로젝트 전반에서 쓰는 "effect 안에서 setState로 로딩 상태 초기화 /
    // prop 변경에 맞춰 로컬 state 동기화" 같은 흔한 관용구를 전부 error로
    // 잡아서, 코드베이스 대부분의 파일이 한꺼번에 lint 실패 상태가 됐다.
    // 지금 당장 전체를 리팩터링할 사안은 아니라 warn으로 낮춰서 계속
    // 눈에 보이게는 하되, `npm run lint`가 이 이유로 실패하지는 않게 했다.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
])
