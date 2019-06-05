const AWS = require('aws-sdk')
const { Component, utils } = require('@serverless/components')

const {
  apiExists,
  createApi,
  validateEndpoints,
  createAuthorizers,
  createPaths,
  createMethods,
  createIntegrations,
  createDeployment,
  removeApi,
  removeMethods,
  removeAuthorizers,
  removeResources,
  removeOutdatedEndpoints
} = require('./utils')

const defaults = {
  region: 'us-east-1',
  name: 'serverless-components-api',
  description: 'Serverless Components API'
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    this.ui.status('Deploying')
    const config = { ...defaults, ...inputs }
    const { name, description, region } = config
    const { stage } = this.context

    // todo quick fix for array of objects in yaml issue
    config.endpoints = Object.keys(config.endpoints).map((e) => config.endpoints[e])

    const apig = new AWS.APIGateway({
      region,
      credentials: this.context.credentials.aws
    })

    const lambda = new AWS.Lambda({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    let apiId = this.state.id || config.id

    if (!apiId) {
      apiId = await createApi({ apig, name, description })
      this.state.id = apiId
      await this.save()
    } else if (!(await apiExists({ apig, apiId }))) {
      throw Error(`the specified api id "${apiId}" does not exist`)
    }

    let endpoints = await validateEndpoints({
      apig,
      apiId,
      endpoints: config.endpoints,
      state: this.state,
      stage,
      region
    })

    endpoints = await createAuthorizers({ apig, lambda, apiId, endpoints })
    endpoints = await createPaths({ apig, apiId, endpoints })
    endpoints = await createMethods({ apig, apiId, endpoints })

    await utils.sleep(2000) // need to sleep for a bit between method and integration creation

    endpoints = await createIntegrations({ apig, lambda, apiId, endpoints })

    // keep endpoints in sync with provider
    await removeOutdatedEndpoints({
      apig,
      apiId,
      endpoints,
      stateEndpoints: this.state.endpoints || []
    })

    await createDeployment({ apig, apiId, stage })

    this.state.endpoints = endpoints
    await this.save()

    const outputs = {
      id: apiId,
      endpoints,
      url: `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}/`
    }

    this.ui.log()
    this.ui.output('id', ` ${outputs.id}`)
    this.ui.output('url', `${outputs.url}`)
    this.ui.output('endpoints', `${endpoints.length}`)
    for (const endpoint of endpoints) {
      this.ui.log(`  - ${endpoint.method} ${endpoint.path}`)
    }

    return outputs
  }

  async remove(inputs = {}) {
    this.ui.status('Removing')
    const config = { ...defaults, ...inputs }

    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    if (this.state.id) {
      await removeApi({ apig, apiId: this.state.id })
    } else if (inputs.id && this.state.endpoints && this.state.endpoints.length !== undefined) {
      await removeAuthorizers({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
      await removeMethods({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
      await removeResources({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
    }

    this.state = {}
    await this.save()

    return {}
  }
}

module.exports = AwsApiGateway
