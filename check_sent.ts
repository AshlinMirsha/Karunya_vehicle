async function main() {
  const conn = await Deno.connectTls({ hostname: "imap.gmail.com", port: 993 });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = conn.readable.getReader();
  const writer = conn.writable.getWriter();

  let buffer = '';
  async function readLine(): Promise<string> {
    while (true) {
      const idx = buffer.indexOf('\r\n');
      if (idx !== -1) {
        const line = buffer.slice(0, idx + 2);
        buffer = buffer.slice(idx + 2);
        return line;
      }
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value);
      if (done) break;
    }
    return '';
  }

  async function sendCmd(tag: string, cmd: string) {
    const fullCmd = `${tag} ${cmd}\r\n`;
    await writer.write(encoder.encode(fullCmd));
    let response = '';
    while (true) {
      const line = await readLine();
      response += line;
      if (line.startsWith(tag + ' ')) {
        break;
      }
    }
    return response;
  }

  try {
    await readLine();
    await sendCmd("A1", `LOGIN "karunya.attendance@gmail.com" "udtlcomlcmuskxjd"`);
    
    // Select Sent Mail folder (in Gmail it's usually "[Gmail]/Sent Mail")
    const selectSent = await sendCmd("A2", `SELECT "[Gmail]/Sent Mail"`);
    console.log("IMAP Select Sent Mail:", selectSent.trim());
    
    const searchRes = await sendCmd("A3", `SEARCH ALL`);
    console.log("IMAP Search Sent:", searchRes.trim());
    
    const match = searchRes.match(/SEARCH (.+)/);
    if (match && match[1].trim()) {
      const ids = match[1].trim().split(' ');
      const lastIds = ids.slice(-5).join(',');
      const fetchRes = await sendCmd("A4", `FETCH ${lastIds} (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE)])`);
      console.log("IMAP Fetch Last 5 Sent:", fetchRes.trim());
    }

    await sendCmd("A5", "LOGOUT");
  } catch (err) {
    console.error("IMAP Error:", err);
  } finally {
    conn.close();
  }
}
main();
