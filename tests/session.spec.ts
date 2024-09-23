/**
 * @adonisjs/session
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import edge from 'edge.js'
import supertest from 'supertest'
import { test } from '@japa/runner'
import { cuid } from '@adonisjs/core/helpers'
import setCookieParser from 'set-cookie-parser'
import { Emitter } from '@adonisjs/core/events'
import { SimpleErrorReporter } from '@vinejs/vine'
import { CookieClient } from '@adonisjs/core/http'
import { fieldContext } from '@vinejs/vine/factories'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { AppFactory } from '@adonisjs/core/factories/app'
import { I18nManagerFactory } from '@adonisjs/i18n/factories'
import { ApplicationService, EventsList } from '@adonisjs/core/types'
import { EncryptionFactory } from '@adonisjs/core/factories/encryption'
import { RequestFactory, ResponseFactory, HttpContextFactory } from '@adonisjs/core/factories/http'

import { defineConfig } from '../index.js'
import { Session } from '../src/session.js'
import { httpServer } from '../tests_helpers/index.js'
import { CookieStore } from '../src/stores/cookie.js'
import type { SessionConfig, SessionStoreFactory } from '../src/types.js'

const app = new AppFactory().create(new URL('./', import.meta.url), () => {}) as ApplicationService
const emitter = new Emitter<EventsList>(app)
const encryption = new EncryptionFactory().create()
const cookieClient = new CookieClient(encryption)
const sessionConfig: SessionConfig = {
  enabled: true,
  age: '2 hours',
  clearWithBrowser: false,
  cookieName: 'adonis_session',
  cookie: {},
}
const cookieDriver: SessionStoreFactory = (ctx, config) => {
  return new CookieStore(config.cookie, ctx)
}

test.group('Session', (group) => {
  group.setup(async () => {
    const ignitor = new IgnitorFactory()
      .merge({
        rcFileContents: {
          providers: [
            () => import('@adonisjs/core/providers/edge_provider'),
            () => import('../providers/session_provider.js'),
          ],
        },
      })
      .withCoreConfig()
      .withCoreProviders()
      .merge({
        config: {
          session: defineConfig({
            store: 'memory',
            stores: {},
          }),
        },
      })
      .create(new URL('./', import.meta.url))

    const ignitorApp = ignitor.createApp('web')
    await ignitorApp.init()
    await ignitorApp.boot()
  })

  test('do not define session id cookie when not initiated', async ({ assert }) => {
    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)

      assert.isFalse(session.initiated)

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.deepEqual(cookies, {})
  })

  test("initiate session with fresh session id when there isn't any session", async ({
    assert,
  }) => {
    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      assert.isTrue(session.fresh)
      assert.isTrue(session.initiated)

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
  })

  test('do not commit to store when session store is empty', async ({ assert }) => {
    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      assert.isTrue(session.fresh)
      assert.isTrue(session.initiated)

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
    assert.lengthOf(Object.keys(cookies), 1)
  })

  test('commit to store when session has data', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.put('username', 'virk')
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.property(cookies, sessionId!)
    assert.equal(cookies[sessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      username: 'virk',
    })
  })

  test('append to existing store', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.put('username', 'virk')
      assert.isTrue(session.has('username'))
      assert.isTrue(session.has('age'))
      assert.deepEqual(session.all(), { username: 'virk', age: 22 })

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.property(cookies, sessionId!)
    assert.equal(cookies[sessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      username: 'virk',
      age: 22,
    })
  })

  test('delete store when session store is empty', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.forget('age')
      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.equal(cookies[sessionId].maxAge, -1)
    assert.lengthOf(Object.keys(cookies), 2)
  })

  test('pull value from the session store', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      assert.equal(session.pull('age'), 22)
      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.equal(cookies[sessionId].maxAge, -1)
    assert.lengthOf(Object.keys(cookies), 2)
  })

  test('initiate value with 1 on increment', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.increment('visits')
      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`

    const { headers } = await supertest(server).get('/').set('cookie', `${sessionIdCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      visits: 1,
    })
  })

  test('initiate value with -1 on decrement', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.decrement('visits')
      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`

    const { headers } = await supertest(server).get('/').set('cookie', `${sessionIdCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      visits: -1,
    })
  })

  test('touch session store when not modified', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.property(cookies, sessionId!)
    assert.equal(cookies[sessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      age: 22,
    })
  })

  test('clear session store', async ({ assert }) => {
    let sessionId = cuid()

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.clear()
      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.equal(cookies[sessionId].maxAge, -1)
    assert.lengthOf(Object.keys(cookies), 2)
  })

  test('throw error when trying to read from uninitiated store', async () => {
    const ctx = new HttpContextFactory().create()
    const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
    session.get('username')
  }).throws(
    'Session store has not been initiated. Make sure you have registered the session middleware'
  )

  test('throw error when trying to write to a read only store', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    const session = new Session(sessionConfig, cookieDriver, emitter, ctx)

    await session.initiate(true)
    assert.isUndefined(session.get('username'))

    session.put('username', 'foo')
  }).throws('Session store is in readonly mode and cannot be mutated')

  test('share session data with templates', async ({ assert }) => {
    let sessionId = cuid()

    edge.registerTemplate('welcome', {
      template: `The user age is {{ session.get('age') }}`,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      try {
        response.send(await ctx.view.render('welcome'))
      } catch (error) {
        console.log(error)
      }

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { text } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    assert.equal(text, 'The user age is 22')
  })
})

test.group('Session | Regenerate', () => {
  test("initiate session with fresh session id when there isn't any session", async ({
    assert,
  }) => {
    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.regenerate()

      assert.isTrue(session.fresh)
      assert.isTrue(session.initiated)
      assert.isFalse(session.hasRegeneratedSession)

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
  })

  test('do not commit to store when session store is empty', async ({ assert }) => {
    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.regenerate()

      assert.isTrue(session.fresh)
      assert.isTrue(session.initiated)
      assert.isFalse(session.hasRegeneratedSession)

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })
    assert.property(cookies, 'adonis_session')
    assert.lengthOf(Object.keys(cookies), 1)
  })

  test('commit to store when session has data', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.regenerate()
      assert.isFalse(session.hasRegeneratedSession)

      session.put('username', 'virk')
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.property(cookies, sessionId!)
    assert.equal(cookies[sessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      username: 'virk',
    })
  })

  test('append to existing store', async ({ assert }) => {
    let sessionId = cuid()
    let newSessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.put('username', 'virk')
      session.regenerate()
      newSessionId = session.sessionId

      assert.isTrue(session.hasRegeneratedSession)

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.notEqual(newSessionId, sessionId)
    assert.property(cookies, newSessionId!)
    assert.equal(cookies[sessionId!].maxAge, -1)
    assert.equal(cookies[newSessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(newSessionId!, cookies[newSessionId!].value), {
      username: 'virk',
      age: 22,
    })
  })

  test('delete store when session store is empty', async ({ assert }) => {
    let sessionId = cuid()
    let newSessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.forget('age')
      session.regenerate()
      newSessionId = session.sessionId

      assert.isTrue(session.hasRegeneratedSession)

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.notEqual(newSessionId, sessionId)
    assert.property(cookies, 'adonis_session')
    assert.notProperty(cookies, newSessionId!)
    assert.equal(cookies[sessionId].maxAge, -1)
    assert.lengthOf(Object.keys(cookies), 2)
  })

  test('touch session store when not modified', async ({ assert }) => {
    let sessionId = cuid()
    let newSessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      session.regenerate()
      newSessionId = session.sessionId

      assert.isTrue(session.hasRegeneratedSession)

      await session.commit()
      response.finish()
    })

    const sessionIdCookie = `adonis_session=${cookieClient.sign('adonis_session', sessionId)}`
    const sessionStoreCookie = `${sessionId}=${cookieClient.encrypt(sessionId, { age: 22 })}`

    const { headers } = await supertest(server)
      .get('/')
      .set('cookie', `${sessionIdCookie}; ${sessionStoreCookie}`)

    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.property(cookies, 'adonis_session')
    assert.property(cookies, sessionId!)
    assert.equal(cookies[sessionId!].maxAge, -1)
    assert.property(cookies, newSessionId!)
    assert.equal(cookies[newSessionId!].maxAge, 90)
    assert.deepEqual(cookieClient.decrypt(newSessionId!, cookies[newSessionId!].value), {
      age: 22,
    })
  })
})

test.group('Session | Flash', (group) => {
  group.setup(async () => {
    const ignitor = new IgnitorFactory()
      .merge({
        rcFileContents: {
          providers: [
            () => import('@adonisjs/core/providers/edge_provider'),
            () => import('../providers/session_provider.js'),
          ],
        },
      })
      .withCoreConfig()
      .withCoreProviders()
      .merge({
        config: {
          session: defineConfig({
            store: 'memory',
            stores: {},
          }),
        },
      })
      .create(new URL('./', import.meta.url))

    const ignitorApp = ignitor.createApp('web')
    await ignitorApp.init()
    await ignitorApp.boot()
  })

  group.each.setup(() => {
    return () => {
      edge.removeTemplate('flash_no_errors_messages')
      edge.removeTemplate('flash_errors_messages')
    }
  })

  test('flash data using the session store', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.flash('status', 'Task created successfully')
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        status: 'Task created successfully',
      },
    })
  })

  test('flash key-value pair', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.flash({ status: 'Task created successfully' })
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        status: 'Task created successfully',
      },
    })
  })

  test('flash input values', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()
      ctx.request.setInitialBody({
        username: 'virk',
      })

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.flash({ status: 'Task created successfully' })
      session.flashAll()
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        username: 'virk',
        status: 'Task created successfully',
      },
    })
  })

  test('flash selected input values', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()
      ctx.request.setInitialBody({
        username: 'virk',
        age: 22,
      })

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.flash({ status: 'Task created successfully' })

      /**
       * The last method call will overwrite others
       */
      session.flashAll()
      session.flashExcept(['username'])
      session.flashOnly(['username'])

      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        username: 'virk',
        status: 'Task created successfully',
      },
    })
  })

  test('read flash messages from the request', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.json(session.flashMessages.all())
        await session.commit()
        response.finish()
      } else {
        session.flash({ status: 'Task created successfully' })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { body, headers: newHeaders } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    const newCookies = setCookieParser.parse(newHeaders['set-cookie'], { map: true })

    assert.deepEqual(body, { status: 'Task created successfully' })
    assert.equal(newCookies[sessionId!].maxAge, -1)
  })

  test('reflash flash messages', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.json(session.flashMessages.all())
        await session.commit()
        response.finish()
      } else if (request.url() === '/reflash') {
        session.reflash()
        await session.commit()
      } else {
        session.flash({ status: 'Task created successfully' })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { headers: reflashedHeaders } = await supertest(server)
      .get('/reflash')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )
    const reflashedCookies = setCookieParser.parse(reflashedHeaders['set-cookie'], { map: true })

    const { body, headers: newHeaders } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${reflashedCookies.adonis_session.value}; ${sessionId}=${
          reflashedCookies[sessionId!].value
        }`
      )

    const newCookies = setCookieParser.parse(newHeaders['set-cookie'], { map: true })

    assert.deepEqual(body, { status: 'Task created successfully' })
    assert.equal(newCookies[sessionId!].maxAge, -1)
  })

  test('reflash and flash together', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.json(session.flashMessages.all())
        await session.commit()
        response.finish()
      } else if (request.url() === '/reflash') {
        session.reflash()
        session.reflashExcept(['id'])
        session.reflashOnly(['id'])
        session.flash({ state: 'success' })
        await session.commit()
      } else {
        session.flash({ status: 'Task created successfully', id: 1 })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { headers: reflashedHeaders } = await supertest(server)
      .get('/reflash')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )
    const reflashedCookies = setCookieParser.parse(reflashedHeaders['set-cookie'], { map: true })

    const { body, headers: newHeaders } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${reflashedCookies.adonis_session.value}; ${sessionId}=${
          reflashedCookies[sessionId!].value
        }`
      )

    const newCookies = setCookieParser.parse(newHeaders['set-cookie'], { map: true })

    assert.deepEqual(body, { id: 1, state: 'success' })
    assert.equal(newCookies[sessionId!].maxAge, -1)
  })

  test('throw error when trying to write to flash messages without initialization', async () => {
    const ctx = new HttpContextFactory().create()
    const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
    session.flash('username', 'virk')
  }).throws(
    'Session store has not been initiated. Make sure you have registered the session middleware'
  )

  test('throw error when trying to write flash messages to a read only store', async () => {
    const ctx = new HttpContextFactory().create()
    const session = new Session(sessionConfig, cookieDriver, emitter, ctx)

    await session.initiate(true)
    session.flash('username', 'foo')
  }).throws('Session store is in readonly mode and cannot be mutated')

  test('flash validation error messages', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      const errorReporter = new SimpleErrorReporter()
      errorReporter.report('Invalid username', 'alpha', fieldContext.create('username', ''), {})
      errorReporter.report(
        'Username is required',
        'required',
        fieldContext.create('username', ''),
        {}
      )
      errorReporter.report('Invalid email', 'email', fieldContext.create('email', ''), {})

      session.flashValidationErrors(errorReporter.createError())
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        errors: {
          email: ['Invalid email'],
          username: ['Invalid username', 'Username is required'],
        },
        errorsBag: {
          E_VALIDATION_ERROR: 'The form could not be saved. Please check the errors below.',
        },
        inputErrorsBag: {
          email: ['Invalid email'],
          username: ['Invalid username', 'Username is required'],
        },
      },
    })
  })

  test('translate validation error summary', async ({ assert }) => {
    const i18nManager = new I18nManagerFactory()
      .merge({
        config: {
          loaders: [
            () => {
              return {
                async load() {
                  return {
                    en: {
                      'errors.E_VALIDATION_ERROR': '{count} errors prohibited form submission',
                    },
                  }
                },
              }
            },
          ],
        },
      })
      .create()

    await i18nManager.loadTranslations()

    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()
      ctx.i18n = i18nManager.locale('en')

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      const errorReporter = new SimpleErrorReporter()
      errorReporter.report('Invalid username', 'alpha', fieldContext.create('username', ''), {})
      errorReporter.report(
        'Username is required',
        'required',
        fieldContext.create('username', ''),
        {}
      )
      errorReporter.report('Invalid email', 'email', fieldContext.create('email', ''), {})

      session.flashValidationErrors(errorReporter.createError())
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        errors: {
          email: ['Invalid email'],
          username: ['Invalid username', 'Username is required'],
        },
        errorsBag: {
          E_VALIDATION_ERROR: '3 errors prohibited form submission',
        },
        inputErrorsBag: {
          email: ['Invalid email'],
          username: ['Invalid username', 'Username is required'],
        },
      },
    })
  })

  test("multiple calls to flashValidationErrors should keep the last one's", async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      const errorReporter = new SimpleErrorReporter()
      const errorReporter1 = new SimpleErrorReporter()
      errorReporter.report('Invalid username', 'alpha', fieldContext.create('username', ''), {})
      errorReporter.report(
        'Username is required',
        'required',
        fieldContext.create('username', ''),
        {}
      )
      errorReporter.report('Invalid email', 'email', fieldContext.create('email', ''), {})

      errorReporter1.report('Invalid name', 'alpha', fieldContext.create('name', ''), {})

      session.flashValidationErrors(errorReporter.createError())
      session.flashValidationErrors(errorReporter1.createError())
      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        errors: {
          name: ['Invalid name'],
        },
        errorsBag: {
          E_VALIDATION_ERROR: 'The form could not be saved. Please check the errors below.',
        },
        inputErrorsBag: {
          name: ['Invalid name'],
        },
      },
    })
  })

  test('flash collection of errors', async ({ assert }) => {
    let sessionId: string | undefined

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      session.flashErrors({
        E_AUTHORIZATION_FAILED: 'Cannot access route',
      })
      session.flashErrors({
        E_ACCESS_DENIED: 'Cannot access resource',
      })

      sessionId = session.sessionId

      await session.commit()
      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    assert.deepEqual(cookieClient.decrypt(sessionId!, cookies[sessionId!].value), {
      __flash__: {
        errorsBag: {
          E_AUTHORIZATION_FAILED: 'Cannot access route',
          E_ACCESS_DENIED: 'Cannot access resource',
        },
      },
    })
  })

  test('access flash messages inside templates', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_messages', {
      template: `{{ old('status') }}`,
    })

    const server = httpServer.create(async (req, res) => {
      try {
        const request = new RequestFactory().merge({ req, res, encryption }).create()
        const response = new ResponseFactory().merge({ req, res, encryption }).create()
        const ctx = new HttpContextFactory().merge({ request, response }).create()

        const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
        await session.initiate(false)
        sessionId = session.sessionId

        if (request.url() === '/prg') {
          response.send(await ctx.view.render('flash_messages'))
          await session.commit()
          response.finish()
        } else {
          session.flash({ status: 'Task created successfully' })
          await session.commit()
        }

        response.finish()
      } catch (error) {
        console.log(error)
      }
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.equal(text, 'Task created successfully')
  })

  test('access flash messages using the @flashMessage tag', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_messages_via_tag', {
      template: `@flashMessage('status')
        <p> {{ $message }} </p>
      @end
      @flashMessage('success')
        <p> {{ $message }} </p>
      @else
        <p> No success message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(await ctx.view.render('flash_messages_via_tag'))
        await session.commit()
        response.finish()
      } else {
        session.flash({ status: 'Task created successfully' })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['<p> Task created successfully </p>', '<p> No success message </p>', '']
    )
  })

  test('use inputError tag when there are no error message', async ({ assert }) => {
    edge.registerTemplate('flash_no_errors_messages', {
      template: `
      @inputError('username')
        @each(message in $messages)
          <p> {{ message }} </p>
        @end
      @else
        <p> No error message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)

      response.send(await ctx.view.render('flash_no_errors_messages'))
      await session.commit()
      response.finish()
    })

    const { text } = await supertest(server).get('/prg')

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['<p> No error message </p>', '']
    )
  })

  test('access input error messages using the @inputError tag', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_errors_messages', {
      template: `
      @inputError('username')
        @each(message in $messages)
          <p> {{ message }} </p>
        @end
      @else
        <p> No error message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(await ctx.view.render('flash_errors_messages'))
        await session.commit()
        response.finish()
      } else {
        const errorReporter = new SimpleErrorReporter()
        errorReporter.report('Invalid username', 'alpha', fieldContext.create('username', ''), {})
        errorReporter.report(
          'Username is required',
          'required',
          fieldContext.create('username', ''),
          {}
        )

        session.flashValidationErrors(errorReporter.createError())
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['', '<p> Invalid username </p>', '<p> Username is required </p>', '']
    )
  })

  test('define @inputError key as a variable', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_errors_messages', {
      template: `
      @inputError(field)
        @each(message in $messages)
          <p> {{ message }} </p>
        @end
      @else
        <p> No error message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(await ctx.view.render('flash_errors_messages', { field: 'username' }))
        await session.commit()
        response.finish()
      } else {
        const errorReporter = new SimpleErrorReporter()
        errorReporter.report('Invalid username', 'alpha', fieldContext.create('username', ''), {})
        errorReporter.report(
          'Username is required',
          'required',
          fieldContext.create('username', ''),
          {}
        )

        session.flashValidationErrors(errorReporter.createError())
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['', '<p> Invalid username </p>', '<p> Username is required </p>', '']
    )
  })

  test('access error messages using the @error tag', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_errors_messages', {
      template: `
      @error('E_ACCESS_DENIED')
        <p> {{ $message }} </p>
      @else
        <p> No error message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(await ctx.view.render('flash_errors_messages'))
        await session.commit()
        response.finish()
      } else {
        session.flashErrors({
          E_ACCESS_DENIED: 'Access denied',
        })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['<p> Access denied </p>', '']
    )
  })

  test('define @error key from a variable', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_errors_messages', {
      template: `
      @error(errorCode)
        <p> {{ $message }} </p>
      @else
        <p> No error message </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(
          await ctx.view.render('flash_errors_messages', { errorCode: 'E_ACCESS_DENIED' })
        )
        await session.commit()
        response.finish()
      } else {
        session.flashErrors({
          E_ACCESS_DENIED: 'Access denied',
        })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['<p> Access denied </p>', '']
    )
  })

  test('access errorsBag using the @errors tag', async ({ assert }) => {
    let sessionId: string | undefined

    edge.registerTemplate('flash_errors_messages', {
      template: `
      @errors()
        <div>
          @each(message in $messages)
            <p> {{ message }} </p>
          @end
        </div>
      @else
        <p> No error messages </p>
      @end
      `,
    })

    const server = httpServer.create(async (req, res) => {
      const request = new RequestFactory().merge({ req, res, encryption }).create()
      const response = new ResponseFactory().merge({ req, res, encryption }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()

      const session = new Session(sessionConfig, cookieDriver, emitter, ctx)
      await session.initiate(false)
      sessionId = session.sessionId

      if (request.url() === '/prg') {
        response.send(await ctx.view.render('flash_errors_messages'))
        await session.commit()
        response.finish()
      } else {
        session.flashErrors({
          E_ACCESS_DENIED: 'Access denied',
        })
        await session.commit()
      }

      response.finish()
    })

    const { headers } = await supertest(server).get('/')
    const cookies = setCookieParser.parse(headers['set-cookie'], { map: true })

    const { text } = await supertest(server)
      .get('/prg')
      .set(
        'Cookie',
        `adonis_session=${cookies.adonis_session.value}; ${sessionId}=${cookies[sessionId!].value}`
      )

    assert.deepEqual(
      text.split('\n').map((line) => line.trim()),
      ['<div>', '<p> Access denied </p>', '</div>', '']
    )
  })
})
