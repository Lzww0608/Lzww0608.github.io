export function reviewNoteForDisplay(note: string): string {
  return note.replace(/初译/gu, '译文').replace(/(?:等待|待)人工(?:校订|裁定|校勘)/gu, '待校核');
}
