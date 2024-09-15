/**
 * @adonisjs/session
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import string from '@poppinss/utils/string'
import { MessageBuilder } from '@adonisjs/core/helpers'

import debug from '../debug.js'
import type { SessionStoreContract, SessionData } from '../types.js'

/**
 * DynamoDB store to read/write session to DynamoDB
 */
export class DynamoDBStore implements SessionStoreContract {
  #client: DynamoDBClient
  #tableName: string
  #keyAttribute: string = 'key'
  #valueAttribute: string = 'value'
  #expiresAtAttribute: string = 'expires_at'
  #ttlSeconds: number

  constructor(
    client: DynamoDBClient,
    tableName: string,
    age: string | number,
    keyAttribute: string | undefined = this.#keyAttribute,
    valueAttribute: string | undefined = this.#valueAttribute,
    expiresAtAttribute: string | undefined = this.#expiresAtAttribute
  ) {
    this.#client = client
    this.#tableName = tableName
    this.#keyAttribute = keyAttribute
    this.#valueAttribute = valueAttribute
    this.#expiresAtAttribute = expiresAtAttribute
    this.#ttlSeconds = string.seconds.parse(age)
    debug('initiating dynamodb store')
  }

  /**
   * Returns session data. A new item will be created if it's
   * missing.
   */
  async read(sessionId: string): Promise<SessionData | null> {
    debug('dynamodb store: reading session data %s', sessionId)

    const command = new GetItemCommand({
      TableName: this.#tableName,
      Key: marshall({ [this.#keyAttribute]: sessionId }),
    })

    const response = await this.#client.send(command)
    if (!response.Item) {
      return null
    }

    if (!response.Item[this.#valueAttribute]) {
      return null
    }

    const item = unmarshall(response.Item)
    const contents = item[this.#valueAttribute] as string
    const expiration = item[this.#expiresAtAttribute] as number

    /**
     * Check if the item has been expired and return null (if expired)
     */
    if (Date.now() > expiration) {
      return null
    }

    /**
     * Verify contents with the session id and return them as an object. The verify
     * method can fail when the contents is not JSON.
     */
    try {
      return new MessageBuilder().verify<SessionData>(contents, sessionId)
    } catch {
      return null
    }
  }

  /**
   * Write session values to DynamoDB
   */
  async write(sessionId: string, values: Object): Promise<void> {
    debug('dynamodb store: writing session data %s, %O', sessionId, values)

    const message = new MessageBuilder().build(values, undefined, sessionId)
    const item = marshall({
      [this.#keyAttribute]: sessionId,
      [this.#valueAttribute]: message,
      [this.#expiresAtAttribute]: Date.now() + this.#ttlSeconds * 1000,
    })

    const command = new PutItemCommand({
      TableName: this.#tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#key) OR #expires_at < :now',
      ExpressionAttributeNames: {
        '#key': this.#keyAttribute,
        '#expires_at': this.#expiresAtAttribute,
      },
      ExpressionAttributeValues: marshall({
        ':now': Date.now(),
      }),
    })

    await this.#client.send(command)
  }

  /**
   * Cleanup session item by removing it
   */
  async destroy(sessionId: string): Promise<void> {
    debug('dynamodb store: destroying session data %s', sessionId)

    const command = new DeleteItemCommand({
      TableName: this.#tableName,
      Key: marshall({ [this.#keyAttribute]: sessionId }),
    })

    await this.#client.send(command)
  }

  /**
   * Updates the value expiry
   */
  async touch(sessionId: string): Promise<void> {
    debug('dynamodb store: touching session data %s', sessionId)

    const command = new UpdateItemCommand({
      TableName: this.#tableName,
      Key: marshall({ [this.#keyAttribute]: sessionId }),
      UpdateExpression: 'SET #expires_at = :expires_at',
      ExpressionAttributeNames: {
        '#expires_at': this.#expiresAtAttribute,
      },
      ExpressionAttributeValues: marshall({
        ':expires_at': Date.now() + this.#ttlSeconds * 1000,
      }),
    })

    await this.#client.send(command)
  }
}
