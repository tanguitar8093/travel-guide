import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter'

interface Progress {
  title: string
  startedAt: number
  steps: TestStep[]
}

export default class ProgressReporter implements Reporter {
  private readonly running = new Map<TestCase, Progress>()
  private timer?: ReturnType<typeof setInterval>
  private logPath?: string

  onBegin(_config: FullConfig, suite: Suite) {
    const directory = resolve('e2e-logs')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const run = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    this.logPath = resolve(directory, `${run}.log`)
    this.log(`測試執行開始，共 ${suite.allTests().length} 個案例。`)
    this.log(`即時紀錄：${this.logPath}`)
    this.timer = setInterval(() => {
      for (const progress of this.running.values()) {
        const current = progress.steps.at(-1)
        const elapsed = Math.floor((Date.now() - progress.startedAt) / 1000)
        this.log(`[等待 ${elapsed} 秒] ${current?.title ?? progress.title}`)
      }
    }, 5000)
    this.timer.unref()
  }

  onTestBegin(test: TestCase) {
    this.running.set(test, {
      title: '準備測試／啟動瀏覽器，尚未進入第一步',
      startedAt: Date.now(),
      steps: [],
    })
    this.log(`[案例開始] ${test.title}`)
  }

  onStepBegin(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'test.step') return
    const progress = this.running.get(test)
    if (progress) {
      progress.steps.push(step)
      progress.startedAt = Date.now()
    }
    this.log(`[開始] ${step.title}`)
  }

  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'test.step') return
    const progress = this.running.get(test)
    if (progress) {
      progress.steps = progress.steps.filter((active) => active !== step)
      progress.title = `${step.title}之後：保存附件／清理，或等待下一步`
      progress.startedAt = Date.now()
    }
    const skipped = step.annotations.find((annotation) => annotation.type === 'skip')
    const status = step.error ? '失敗' : skipped ? 'SKIP' : '完成'
    this.log(`[${status}] ${step.title}（${(step.duration / 1000).toFixed(1)} 秒）`)
    if (skipped?.description) this.log(skipped.description)
    if (step.error) this.log(step.error.message ?? '此步驟發生錯誤。')
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.running.delete(test)
    const labels: Record<TestResult['status'], string> = {
      passed: '通過',
      failed: '失敗',
      timedOut: '逾時',
      skipped: '略過',
      interrupted: '已中止',
    }
    this.log(`[案例${labels[result.status]}] ${test.title}（${(result.duration / 1000).toFixed(1)} 秒）`)
    for (const error of result.errors) this.log(error.message ?? '案例發生錯誤。')
  }

  onError(error: TestError) {
    this.log(`[執行錯誤] ${error.message ?? '測試執行器發生錯誤。'}`)
  }

  onStdOut(chunk: string | Buffer) {
    this.log(chunk.toString().trimEnd())
  }

  onStdErr(chunk: string | Buffer) {
    this.log(chunk.toString().trimEnd())
  }

  onEnd(result: FullResult) {
    this.stop()
    const labels: Record<FullResult['status'], string> = {
      passed: '通過', failed: '失敗', timedout: '逾時', interrupted: '已中止',
    }
    this.log(`[全部結束] ${labels[result.status]}。HTML 報告與錄影：npm run e2e:report`)
  }

  onExit() {
    this.stop()
  }

  private stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  private log(message: string) {
    let safe = message
    for (const [name, value] of Object.entries(process.env)) {
      if (value && /PASSWORD|SECRET|TOKEN|KEY/.test(name)) safe = safe.replaceAll(value, '[REDACTED]')
    }
    const line = `[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] ${safe}\n`
    process.stdout.write(line)
    if (this.logPath) appendFileSync(this.logPath, line, { mode: 0o600 })
  }
}
