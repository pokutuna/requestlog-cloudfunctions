import express = require('express');
import request = require('supertest');

import { makeMiddleware } from './make-middleware';

const logger = jest.fn();
const app = express();
app.enable('trust proxy'); // Cloud Functions respects X-Forwarded-For
app.use(makeMiddleware('test', logger));
app.all('/error', () => {
  throw new Error('simulated error');
});
app.all('*', (_, res) => res.send('ok'));

beforeEach(() => logger.mockReset());

test('pass httpRequest to logger', async () => {
  const userAgent = 'Test/requestlog-cloudfunctions';
  const referer = 'https://github.com/pokutuna/requestlog-cloudfunctions';
  const ips = '1.1.1.1,2.2.2.2';
  const traceContext = '12345/67890';

  await request(app)
    .get('/')
    .set('User-Agent', userAgent)
    .set('Referer', referer)
    .set('X-Forwarded-For', ips)
    .set('X-Cloud-Trace-Context', traceContext);

  expect(logger).toBeCalledTimes(1);
  expect(logger).toBeCalledWith(
    expect.objectContaining({
      requestMethod: 'GET',
      requestUrl: '/',
      status: 200,
      responseSize: 'ok'.length,
      userAgent,
      remoteIp: '1.1.1.1',
      referer,
      latency: {
        seconds: expect.anything(),
        nanos: expect.anything(),
      },
    }),
    `projects/test/traces/12345`
  );
});

test('error in handler', async () => {
  await request(app).post('/error');

  expect(logger).toBeCalledTimes(1);
  expect(logger).toBeCalledWith(
    expect.objectContaining({
      requestMethod: 'POST',
      requestUrl: '/error',
      status: 500,
      latency: {
        seconds: expect.anything(),
        nanos: expect.anything(),
      },
    }),
    expect.stringMatching('projects/test/traces/')
  );
});

test('304 response with etag', async () => {
  const res = await request(app).get('/with/etag');
  const etag = res.get('ETag');

  await request(app)
    .get('/with/etag')
    .set('If-None-Match', etag);

  expect(logger).toBeCalledTimes(2);
  expect(logger).toHaveBeenLastCalledWith(
    expect.objectContaining({
      requestMethod: 'GET',
      requestUrl: '/with/etag',
      status: 304,
      responseSize: 0,
      latency: {
        seconds: expect.anything(),
        nanos: expect.anything(),
      },
    }),
    expect.stringMatching('projects/test/traces/')
  );
});
