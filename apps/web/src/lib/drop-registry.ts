// The browser normalizes uploaded pictures to a small PNG before submission.
export function parseDropPhoto(
  data: string,
  remove: boolean,
): string | null | false {
  if (!data) return remove ? "" : null;
  if (
    data.length > 100000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)
  )
    return false;
  const bytes = Buffer.from(data.split(",")[1], "base64");
  if (
    bytes.length < 24 ||
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(16) !== 100 ||
    bytes.readUInt32BE(20) !== 100
  )
    return false;
  return data;
}
