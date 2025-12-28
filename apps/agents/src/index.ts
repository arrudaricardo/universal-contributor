import { Elysia, t } from 'elysia'

new Elysia()
  .get('/id/', ({body}) => body, {
    body: t.Object({
      url: t.String()
    })
  })
    .listen(3001)
