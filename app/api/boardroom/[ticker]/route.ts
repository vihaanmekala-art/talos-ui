import { NextResponse } from "next/server";
import formatBoardroomResponse from "../../../../lib/boardroomResponse";

export async function POST(req: Request, { params }: { params: { ticker: string } }) {
  const body = await req.json().catch(() => null);
  const session_record = body?.session_record;
  const executive_output = body?.executive_output;

  if (!session_record?.id) {
    return NextResponse.json({ error: "Missing session_record.id in request body" }, { status: 400 });
  }

  return NextResponse.json(formatBoardroomResponse(session_record.id, executive_output));
}

export async function GET() {
  return NextResponse.json({ error: "Use POST with { session_record, executive_output }" }, { status: 405 });
}
