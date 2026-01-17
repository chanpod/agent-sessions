// Simple test server to verify detection works
const http = require('http');

const port = 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from test server!');
});

server.listen(port, () => {
  // Output various patterns that should be detected
  console.log(`Server running on port ${port}`);
  console.log(`Local: http://localhost:${port}`);
  console.log(`Network: http://127.0.0.1:${port}`);
  console.log('Server is ready!');
});

// Keep server running
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
});
