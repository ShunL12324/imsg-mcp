// Shared chat.db query helpers

export const APPLE_EPOCH_OFFSET = 978307200;

export const QUERY = `
  SELECT
    m.rowid           AS rowid,
    m.guid,
    m.text,
    m.attributedBody,
    m.is_from_me,
    m.date            AS apple_date,
    h.id              AS sender,
    c.chat_identifier
  FROM message m
  LEFT JOIN handle h ON m.handle_id = h.rowid
  LEFT JOIN chat_message_join cmj ON m.rowid = cmj.message_id
  LEFT JOIN chat c ON cmj.chat_id = c.rowid
  WHERE m.rowid > ?
  ORDER BY m.rowid ASC
`;

export interface MessageRow {
  rowid: number;
  guid: string;
  text: string | null;
  attributedBody: Uint8Array | null;
  is_from_me: number;
  apple_date: number;
  sender: string | null;
  chat_identifier: string | null;
}

/**
 * Extract plain text from an NSKeyedArchiver binary plist (attributedBody).
 * Returns the longest non-metadata string found in the plist object table,
 * which is the NSString payload of the NSAttributedString.
 */
export function extractAttributedText(data: Uint8Array | null): string | null {
  if (!data || data.length < 8) return null;
  if (String.fromCharCode(data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]) !== "bplist00") return null;

  // Read trailer (last 32 bytes)
  const t = data.length - 32;
  const offsetSize   = data[t + 6];
  const numObjects   = readUint64(data, t + 8);
  const offTableOff  = readUint64(data, t + 24);

  let best = "";

  for (let i = 0; i < numObjects; i++) {
    const objOff = readInt(data, offTableOff + i * offsetSize, offsetSize);
    const typeByte = data[objOff];
    const hi = typeByte >> 4;

    let str: string | null = null;

    if (hi === 0x5) {
      // ASCII string
      const [len, pos] = readPlistLen(data, objOff);
      str = new TextDecoder("ascii").decode(data.subarray(pos, pos + len));
    } else if (hi === 0x6) {
      // UTF-16BE string (len = code units)
      const [len, pos] = readPlistLen(data, objOff);
      str = new TextDecoder("utf-16be").decode(data.subarray(pos, pos + len * 2));
    }

    if (str && str.length > best.length && !str.startsWith("$") && !str.startsWith("NS")) {
      best = str;
    }
  }

  return best || null;
}

/** Resolve text: prefer plain text column, fall back to attributedBody */
export function resolveText(row: Pick<MessageRow, "text" | "attributedBody">): string | null {
  return row.text ?? extractAttributedText(row.attributedBody);
}

// ── Binary plist helpers ──────────────────────────────────────────────────────

function readInt(data: Uint8Array, offset: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size; i++) val = val * 256 + data[offset + i];
  return val;
}

function readUint64(data: Uint8Array, offset: number): number {
  // JavaScript can't represent full uint64, but plist counts fit in 53-bit safe integer
  let hi = 0, lo = 0;
  for (let i = 0; i < 4; i++) hi = hi * 256 + data[offset + i];
  for (let i = 4; i < 8; i++) lo = lo * 256 + data[offset + i];
  return hi * 0x100000000 + lo;
}

/** Read a plist string/array/data length starting at objOffset, return [length, dataOffset] */
function readPlistLen(data: Uint8Array, objOffset: number): [number, number] {
  const nibble = data[objOffset] & 0xF;
  if (nibble !== 0xF) return [nibble, objOffset + 1];
  // Extended: next byte is 0x1X where X gives byte width of length int
  const intType = data[objOffset + 1];
  const intSize = 1 << (intType & 0xF);
  const len = readInt(data, objOffset + 2, intSize);
  return [len, objOffset + 2 + intSize];
}
