/*
 * @adonisjs/session
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { test } from '@japa/runner'
import { setTimeout } from 'node:timers/promises'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBStore } from '../../src/stores/dynamodb.js'

const sessionId = '1234'
const tableName = 'Session'
const credentials = {
  accessKeyId: 'accessKeyId',
  secretAccessKey: 'secretAccessKey',
}
const region = 'us-east-1'
const endpoint = 'http://localhost:8000'

const dynamoDBClient = new DynamoDBClient({
  region,
  endpoint,
  credentials,
})

async function getSession(id: string) {
  const result = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ key: id }),
    })
  )

  if (!result.Item) {
    return null
  }

  const item = unmarshall(result.Item)

  return JSON.parse(item.value) ?? null
}

async function getExpiry(id: string) {
  const result = await dynamoDBClient.send(
    new GetItemCommand({
      TableName: tableName,
      Key: marshall({ key: id }),
    })
  )

  if (!result.Item) {
    return 0
  }

  const item = unmarshall(result.Item)

  return item.expires_at as number
}

test.group('DynamoDB store', (group) => {
  group.tap((t) => {
    t.skip(!!process.env.NO_DYNAMODB, 'DynamoDB not available in this environment')
  })

  group.each.setup(() => {
    return async () => {
      await dynamoDBClient.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { key: { S: sessionId } },
        })
      )
    }
  })

  test('return null when value is missing', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, tableName, '2 hours')
    const value = await session.read(sessionId)
    assert.isNull(value)
  })

  test('get session existing value', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, tableName, '2 hours')
    await session.write(sessionId, { message: 'hello-world' })

    const value = await session.read(sessionId)
    assert.deepEqual(value, { message: 'hello-world' })
  })

  test('return null when session data is expired', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, tableName, 1)
    await session.write(sessionId, { message: 'hello-world' })

    await setTimeout(2000)

    const value = await session.read(sessionId)

    assert.isNull(value)
  }).disableTimeout()

  test('ignore malformed contents', async ({ assert }) => {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: { key: { S: sessionId }, value: { S: 'foo' } },
      })
    )

    const session = new DynamoDBStore(dynamoDBClient, tableName, 1)
    const value = await session.read(sessionId)
    assert.isNull(value)
  })

  test('delete key on destroy', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, tableName, '2 hours')

    await session.write(sessionId, { message: 'hello-world' })
    await session.destroy(sessionId)

    const storedValue = await getSession(sessionId)
    assert.isNull(storedValue)
  })

  test('update session expiry on touch', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, tableName, 10)
    await session.write(sessionId, { message: 'hello-world' })
    const expiry = await getExpiry(sessionId)
    await session.touch(sessionId)

    /**
     * Ensuring the new expiry time is greater than the old expiry time
     */
    const expiryPostTouch = await getExpiry(sessionId)
    assert.isAtLeast(expiryPostTouch, expiry)
  }).disableTimeout()
})

test.group('DynamoDB store with custom key attributes', (group) => {
  const keyAttribute = 'sessionId'
  const customTableName = 'CustomKeySession'
  group.tap((t) => {
    t.skip(!!process.env.NO_DYNAMODB, 'DynamoDB not available in this environment')
  })

  group.each.setup(() => {
    return async () => {
      await dynamoDBClient.send(
        new DeleteItemCommand({
          TableName: customTableName,
          Key: { sessionId: { S: sessionId } },
        })
      )
    }
  })

  test('return null when value is missing', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, customTableName, '2 hours', keyAttribute)
    const value = await session.read(sessionId)
    assert.isNull(value)
  })

  test('get session existing value', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, customTableName, '2 hours', keyAttribute)
    await session.write(sessionId, { message: 'hello-world' })

    const value = await session.read(sessionId)
    assert.deepEqual(value, { message: 'hello-world' })
  })

  test('return null when session data is expired', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, customTableName, 1, keyAttribute)
    await session.write(sessionId, { message: 'hello-world' })

    await setTimeout(2000)

    const value = await session.read(sessionId)

    assert.isNull(value)
  }).disableTimeout()

  test('ignore malformed contents', async ({ assert }) => {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: customTableName,
        Item: { sessionId: { S: sessionId }, sessionValue: { S: 'foo' } },
      })
    )

    const session = new DynamoDBStore(dynamoDBClient, customTableName, 1, keyAttribute)
    const value = await session.read(sessionId)
    assert.isNull(value)
  })

  test('delete key on destroy', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, customTableName, '2 hours', keyAttribute)

    await session.write(sessionId, { message: 'hello-world' })
    await session.destroy(sessionId)

    const storedValue = await getSession(sessionId)
    assert.isNull(storedValue)
  })

  test('update session expiry on touch', async ({ assert }) => {
    const session = new DynamoDBStore(dynamoDBClient, customTableName, 10, keyAttribute)
    await session.write(sessionId, { message: 'hello-world' })
    const expiry = await getExpiry(sessionId)
    await session.touch(sessionId)

    /**
     * Ensuring the new expiry time is greater than the old expiry time
     */
    const expiryPostTouch = await getExpiry(sessionId)
    assert.isAtLeast(expiryPostTouch, expiry)
  }).disableTimeout()
})
