import net from 'node:net';

/**
 * Minimal SMTP server for tests: speaks just enough of the protocol to accept a
 * message and hand it back. Deliberately does not advertise STARTTLS, so the
 * client stays in plaintext.
 */
export function startSmtpSink() {
  const received = [];
  const server = net.createServer((sock) => {
    let buffer = '';
    let inData = false;
    let current = { to: [], from: '', data: '' };

    const send = (line) => sock.write(line + '\r\n');
    send('220 sink.test ESMTP');

    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(current);
            current = { to: [], from: '', data: '' };
            send('250 OK queued');
          } else {
            current.data += line + '\n';
          }
          continue;
        }

        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) send('250-sink.test\r\n250 SIZE 10485760');
        else if (cmd.startsWith('MAIL FROM')) { current.from = line.slice(10).trim(); send('250 OK'); }
        else if (cmd.startsWith('RCPT TO')) { current.to.push(line.slice(8).trim()); send('250 OK'); }
        else if (cmd === 'DATA') { inData = true; send('354 End data with <CR><LF>.<CR><LF>'); }
        else if (cmd === 'QUIT') { send('221 Bye'); sock.end(); }
        else if (cmd === 'RSET') { current = { to: [], from: '', data: '' }; send('250 OK'); }
        else send('250 OK');
      }
    });
    sock.on('error', () => { /* client hangs up between tests */ });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, received, close: () => server.close() });
    });
  });
}
