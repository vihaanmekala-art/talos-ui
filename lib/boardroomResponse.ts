import { BoardroomResponse } from "../types/boardroom";

export function formatBoardroomResponse(sessionId: string, verdict: unknown): BoardroomResponse {
  return {
    session_id: sessionId,
    verdict,
  };
}

export default formatBoardroomResponse;
