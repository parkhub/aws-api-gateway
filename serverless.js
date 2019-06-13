const AWS = require('aws-sdk')
const { Component, utils } = require('@serverless/core')

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
  stage: 'dev',
  name: 'serverless-components-api',
  description: 'Serverless Components API'
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    this.context.status('Deploying')
    const config = { ...defaults, ...inputs }
    const { name, description, region, stage } = config

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
      url: `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`
    }

    let endpointsOutputValue = `\n`
    for (const endpoint of outputs.endpoints) {
      endpointsOutputValue = `${endpointsOutputValue}    - ${endpoint.method} ${endpoint.path}\n`
    }

    this.context.log()
    this.context.output('id', `       ${outputs.id}`)
    this.context.output('url', `      ${outputs.url}`)
    this.context.output('endpoints', `${endpointsOutputValue}`)

    return outputs
  }

  async remove(inputs = {}) {
    this.context.status('Removing')
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
