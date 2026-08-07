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
    await sendCmd("A2", `SELECT INBOX`);
    
    // Fetch body of message 10
    const fetchBody = await sendCmd("A3", `FETCH 10 BODY[TEXT]`);
    console.log("IMAP Fetch Body of ID 10:", fetchBody);
    
    // Let's also search for all failure notices
    const searchFailures = await sendCmd("A4", `SEARCH SUBJECT "Failure"`);
    console.log("Failures Search Result:", searchFailures);

    await sendCmd("A5", "LOGOUT");
  } catch (err) {
    console.error("IMAP Error:", err);
  } finally {
    conn.close();
  }
}
main();
