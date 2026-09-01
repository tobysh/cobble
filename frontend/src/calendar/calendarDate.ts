// Pure date/label helpers shared by `CalendarGrid` and its callers
// (`CalendarView`, `database/CalendarDbView`). Split out of `CalendarGrid.tsx`
// itself (rather than just exported alongside the component) so that file
// stays components-only for React Fast Refresh.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
