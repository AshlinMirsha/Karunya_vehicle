import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Let's connect to imap.gmail.com:993 using TLS
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
    const greeting = await readLine();
    console.log("IMAP Greeting:", greeting.trim());

    // Login (base64 or plain)
    const loginRes = await sendCmd("A1", `LOGIN "karunya.attendance@gmail.com" "udtlcomlcmuskxjd"`);
    console.log("IMAP Login:", loginRes.trim());

    // Select INBOX to check for bounces
    const selectInbox = await sendCmd("A2", `SELECT INBOX`);
    console.log("IMAP Select INBOX:", selectInbox.trim());

    // Search for any messages
    const searchRes = await sendCmd("A3", `SEARCH ALL`);
    console.log("IMAP Search:", searchRes.trim());

    // Let's fetch the last 3 messages headers if any
    const match = searchRes.match(/SEARCH (.+)/);
    if (match && match[1].trim()) {
      const ids = match[1].trim().split(' ');
      const lastIds = ids.slice(-5).join(',');
      const fetchRes = await sendCmd("A4", `FETCH ${lastIds} (BODY[HEADER.FIELDS (SUBJECT TO FROM DATE)])`);
      console.log("IMAP Fetch Last 5:", fetchRes.trim());
    }

    await sendCmd("A5", "LOGOUT");
  } catch (err) {
    console.error("IMAP Error:", err);
  } finally {
    conn.close();
  }
}

main();
