import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BulkLabelToolbar } from './BulkLabelToolbar'

const props = {
  count: 2,
  hiddenCount: 1,
  disabled: false,
  canSelect: true,
  labels: [{ id: 'food', name: '美食', color: '#123456' }],
  labelId: 'food',
  onLabelChange: () => {},
  onSelectAll: () => {},
  onClear: () => {},
  onApply: () => {},
  onExit: () => {},
}

it('shows selection, hidden count, additive semantics and named failures', () => {
  const html = renderToStaticMarkup(<BulkLabelToolbar {...props} result={{
    succeededIds: ['first'],
    failures: [{ id: 'second', name: '餐廳', message: '餐廳套用標籤失敗：權限不足' }],
  }} />)
  expect(html).toContain('已選 2 筆')
  expect(html).toContain('1 筆不在目前結果中')
  expect(html).toContain('套用標籤（2）')
  expect(html).toContain('保留原有標籤')
  expect(html).toContain('成功套用 1 筆，失敗 1 筆')
  expect(html).toContain('失敗項目保留選取')
  expect(html).toContain('餐廳套用標籤失敗：權限不足')
})

it('disables every control while processing', () => {
  const html = renderToStaticMarkup(<BulkLabelToolbar {...props} disabled />)
  expect(html.match(/disabled=""/g)).toHaveLength(5)
  expect(html).toContain('處理中…')
})

it('requires both a selection and an available target label', () => {
  const empty = renderToStaticMarkup(<BulkLabelToolbar {...props} count={0} />)
  expect(empty).toContain('disabled="">套用標籤（0）')
  const missing = renderToStaticMarkup(<BulkLabelToolbar {...props} labelId="missing" />)
  expect(missing).toContain('disabled="">套用標籤（2）')
  const noLabels = renderToStaticMarkup(<BulkLabelToolbar {...props} labels={[]} />)
  expect(noLabels).toContain('尚無標籤，請先至標籤模組建立')
})
