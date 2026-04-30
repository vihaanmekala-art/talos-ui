
import { NextResponse, type NextRequest } from "next/server";
import formatBoardroomResponse from "../../../../lib/boardroomResponse";

export async function POST(request: NextRequest, context: { params: any }) {
  const params = await context.params;
  const body = await request.json().catch(() => null);
  const session_record = body?.session_record;
  const executive_output = body?.executive_output;

  if (!session_record?.id) {
    return NextResponse.json({ error: "Missing session_record.id in request body" }, { status: 400 });
  }

  return NextResponse.json(formatBoardroomResponse(session_record.id, executive_output));
}

export async function GET(request: NextRequest, context: { params: any }) {
  const params = await context.params;
  const ticker = params?.ticker

  // If your application derives session_record/executive_output internally,
  // replace the placeholder logic below with that implementation.
  // For now, return a 400 if ticker is missing.
  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker in params" }, { status: 400 });
  }

  // Placeholder: echo ticker as session id and empty verdict. Replace with real logic.
  const sessionId = `boardroom-${String(ticker)}`
  const verdict = { message: `No verdict generated for ${String(ticker)}` }

  return NextResponse.json(formatBoardroomResponse(sessionId, verdict));
}
