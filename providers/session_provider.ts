/*
 * @adonisjs/session
 *
 * (c) AdonisJS
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

import { ApplicationService } from '@adonisjs/core/types'
import { extendHttpContext } from '../src/bindings/http_context.js'
import { extendApiClient } from '../src/bindings/api_client.js'

export default class SessionProvider {
  constructor(protected app: ApplicationService) {}

  /**
   * Register Session Manager in the container
   */
  async register() {
    this.app.container.singleton('session', async () => {
      const { SessionManager } = await import('../src/session_manager.js')

      const encryption = await this.app.container.make('encryption')
      const redis = await this.app.container.make('redis').catch(() => undefined)
      const config = this.app.config.get<any>('session', {})

      return new SessionManager(config, encryption, redis)
    })
  }

  /**
   * Register bindings
   */
  async boot() {
    const sessionManager = await this.app.container.make('session')

    /**
     * Add `session` getter to the HttpContext class
     */
    extendHttpContext(sessionManager)

    /**
     * Add some macros and getter to japa/api-client classes for
     * easier testing
     */
    extendApiClient(sessionManager)
  }
}