export type BoardroomResponse = {
  status: string;
  session_id: number; // FastAPI/SQLAlchemy IDs are typically integers
  verdict: string;    // This is the combined text from your Executive Coordinator
};