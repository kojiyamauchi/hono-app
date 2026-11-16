/** `SELECT id ... FOR UPDATE` などのロック取得で返るid行。 */
export type LockedIdRow = {
  id: number
}
