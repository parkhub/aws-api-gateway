const AWS = require('aws-sdk')
const { Component, utils } = require('@serverless/core')

const {
  apiExists,
  createApi,
  validateEndpoints,
  validateModels,
  createAuthorizers,
  createPaths,
  createMethods,
  createMethodResponses,
  createModels,
  createIntegrations,
  createIntegrationResponses,
  createDeployment,
  enableCORS,
  flattenArrays,
  mergeEndpointObjects,
  mergeModelObjects,
  removeApi,
  removeMethods,
  removeAuthorizers,
  removeResources,
  removeOutdatedEndpoints,
  removeOutdatedModels,
  retry,
  updateApi
} = require('./utils')

const defaults = {
  region: 'us-east-1',
  stage: 'dev',
  description: 'Serverless Components API',
  endpointTypes: ['EDGE']
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    this.context.status('Deploying')

    const config = { ...defaults, ...inputs }

    config.name = this.state.name || config.name || this.context.resourceId()

    const { name, description, region, stage, endpointTypes, deploymentDescription } = config

    flattenArrays(config)

    this.context.debug(`Starting API Gateway deployment with name ${name} in the ${region} region`)

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
      this.context.debug(`API ID not found in state. Creating a new API.`)
      apiId = await createApi({ apig, name, description, endpointTypes, config })
      this.context.debug(`API with ID ${apiId} created.`)
      this.state.id = apiId
      await this.save()
    } else if (!(await apiExists({ apig, apiId }))) {
      throw Error(`the specified api id "${apiId}" does not exist`)
    }

    if (config.cors) {
      this.context.debug(`Append options and add cors headers to configured endpoints for API ID ${apiId}`)

      config.endpoints = enableCORS({ endpoints: config.endpoints })
    }

    this.context.debug(`Update API Settings for API ID ${apiId}.`)
    apiId = await updateApi({ apig, apiId, name, description, endpointTypes, config, state: this.state })

    this.context.debug(`Validating ownership for the provided endpoints for API ID ${apiId}.`)

    let endpoints = await validateEndpoints({
      apig,
      apiId,
      endpoints: config.endpoints,
      lambda,
      state: this.state,
      stage,
      region
    })

    this.context.debug(`Validating models provided for API ID ${apiId}`)

    let models = await validateModels({ models: config.models || [], state: this.state, apiId })

    this.context.debug(`Deploying models for API ID ${apiId}`)

    models = await createModels({ apig, apiId, models })
    this.state.models = mergeModelObjects({
      models,
      configModels: config.models || [],
      stateModels: this.state.models || []
    })
    this.save()

    this.context.debug(`Deploying authorizers if any for API ID ${apiId}.`)

    endpoints = await createAuthorizers({ apig, lambda, apiId, endpoints })

    this.context.debug(`Deploying paths/resources for API ID ${apiId}.`)

    endpoints = await createPaths({ apig, apiId, endpoints })

    this.context.debug(`Deploying methods for API ID ${apiId}.`)

    endpoints = await createMethods({ apig, apiId, endpoints })

    // save state of deployed endpoints with no integrations setup
    // when first deploying an endpoint if something fails that endpoint will have to be manually 
    // removed from the state object inorder to rety unless partially saved
    const modE = endpoints.slice().map(e => {
      delete e.responses
      delete e.params
      return e
    })
    this.state.endpoints = mergeEndpointObjects({
      endpoints: modE,
      configEndpoints: config.endpoints,
      stateEndpoints: this.state.endpoints || []
    })
    this.save()

    this.context.debug(`Sleeping for couple of seconds before creating method integration.`)

    // need to sleep for a bit between method and integration creation
    await utils.sleep(2000)

    this.context.debug(`Creating integrations for the provided methods for API ID ${apiId}.`)

    endpoints = await createIntegrations({ apig, lambda, apiId, endpoints })

    this.context.debug(`Creating method responses for API ID ${apiId}.`)

    endpoints = await createMethodResponses({ apig, apiId, endpoints })

    this.context.debug(`Creating integration responses for API ID ${apiId}.`)

    endpoints = await createIntegrationResponses({apig, apiId, endpoints})

    this.context.debug(`Removing any old models for API ID ${apiId}`)

    models = mergeModelObjects({
      models,
      configModels: config.models || [],
      stateModels: this.state.models || []
    })

    await removeOutdatedModels({
      apig,
      apiId,
      models,
      stateModels: this.state.models || []
    })

    this.context.debug(`Removing any old endpoints for API ID ${apiId}.`)

    endpoints = mergeEndpointObjects({
      endpoints,
      configEndpoints: config.endpoints,
      stateEndpoints: this.state.endpoints || []
    })

    // keep endpoints in sync with provider
    await removeOutdatedEndpoints({
      apig,
      apiId,
      endpoints,
      stateEndpoints: this.state.endpoints || []
    })

    this.context.debug(
      `Creating deployment for API ID ${apiId} in the ${stage} stage and the ${region} region.`
    )

    await retry(() => createDeployment({ apig, apiId, stage, deploymentDescription }))

    config.url = `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}`

    this.state.endpoints = endpoints
    this.state.models = models
    this.state.name = config.name
    this.state.region = config.region
    this.state.stage = config.stage
    this.state.url = config.url
    await this.save()

    this.context.debug(`Deployment successful for the API named ${name} in the ${region} region.`)
    this.context.debug(`API URL is ${config.url}.`)

    const outputs = {
      name: config.name,
      id: apiId,
      endpoints,
      url: config.url
    }

    return outputs
  }

  async remove(inputs = {}) {
    this.context.status('Removing')

    const apig = new AWS.APIGateway({
      region: this.state.region || defaults.region,
      credentials: this.context.credentials.aws
    })

    if (this.state.id) {
      this.context.debug(
        `API ID ${this.state.id} found in state. Removing from the ${this.state.region}.`
      )
      await removeApi({ apig, apiId: this.state.id })

      this.context.debug(
        `API with ID ${this.state.id} was successfully removed from the ${this.state.region} region.`
      )
    } else if (inputs.id && this.state.endpoints && this.state.endpoints.length !== undefined) {
      this.context.debug(`No API ID found in state.`)
      this.context.debug(`Removing any previously deployed authorizers.`)

      await removeAuthorizers({ apig, apiId: inputs.id, endpoints: this.state.endpoints })

      this.context.debug(`Removing any previously deployed methods.`)

      await removeMethods({ apig, apiId: inputs.id, endpoints: this.state.endpoints })

      this.context.debug(`Removing any previously deployed resources.`)

      await removeResources({ apig, apiId: inputs.id, endpoints: this.state.endpoints })
    }

    const outputs = {
      name: this.state.name,
      id: this.state.id,
      endpoints: this.state.endpoints,
      url: this.state.url
    }

    this.context.debug(`Flushing state for the API Gateway component.`)

    this.state = {}
    await this.save()

    return outputs
  }
}

module.exports = AwsApiGateway
