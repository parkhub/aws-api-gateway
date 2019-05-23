const AWS = require('aws-sdk')
const { Component } = require('@serverless/components')

const {
  apiExists,
  createApi,
  validateEndpoints,
  createPaths,
  createMethods,
  createIntegrations,
  createDeployment,
  removeApi,
  removeMethods,
  removeResources
} = require('./utils')

const defaults = {
  region: 'us-east-1',
  name: 'serverless-components-api',
  description: 'Serverless Components API'
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    this.cli.status('Deploying')
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

    endpoints = await createPaths({ apig, apiId, endpoints })
    endpoints = await createMethods({ apig, apiId, endpoints })

    this.state.endpoints = endpoints
    await this.save()

    endpoints = await createIntegrations({ apig, lambda, apiId, endpoints })

    await createDeployment({ apig, apiId, stage })

    const outputs = {
      id: apiId,
      endpoints,
      url: `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}/`
    }

    this.cli.outputs(outputs)

    return outputs
  }

  async remove(inputs = {}) {
    this.cli.status('Removing')
    const config = { ...defaults, ...inputs }

    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    if (this.state.id) {
      await removeApi({ apig, apiId: this.state.id })
    } else if (inputs.id && this.state.endpoints && this.state.endpoints.length !== undefined) {
      await removeMethods({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
      await removeResources({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
    }

    this.state = {}
    await this.save()

    return {}
  }
}

module.exports = AwsApiGateway
