export { closeDatabase, getDb, getDbPath, initDatabase } from "./client";
export {
  addNote,
  clearNotes,
  deleteNote,
  getNotesDbInfo,
  listNotes,
  type NoteDto,
} from "./notes";
export {
  listCrawlResults,
  saveCrawlResult,
  type CrawlResultDto,
} from "./crawlResults";
export {
  notes,
  crawlResults,
  type Note,
  type NewNote,
  type CrawlResult,
} from "./schema";
