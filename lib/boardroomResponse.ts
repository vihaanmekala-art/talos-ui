import { BoardroomResponse } from "../types/boardroom";

export function formatBoardroomResponse(
  sessionId: any, 
  verdict: unknown, 
  status: string = "Success" // Added status parameter with a default
): BoardroomResponse {
  return {
    status,
    session_id: Number(sessionId), 
    verdict: verdict as string,
  };
}

export default formatBoardroomResponse;