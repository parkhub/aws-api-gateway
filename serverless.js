const AWS = require('aws-sdk')
const { Component } = require('@serverless/core')

const {
  apiExists,
  createApi,
  createDeployment,
  enableCORS,
  flattenArrays,
  removeApi,
  updateApi,
  createModels,
  createPaths,
  addLambdaPermissions
} = require('./utils')

const defaultRestAPI = {
  name: 'Test API',
  region: 'us-east-1',
  description: 'Public API',
  minimumCompressionSize: 1048576,
  binaryMediaTypes: ['multipart/form-data'],
  deploymentDescription: new Date().toISOString(),
  mode: 'overwrite'
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    const config = { ...defaultRestAPI, ...inputs }
    let { name, description, minimumCompressionSize, binaryMediaTypes, deploymentDescription, endpoints, models, cors, mode } = config

    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    const lambda = new AWS.Lambda({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    let apiId = this.state.id || config.id
    if (!apiId) {
      this.context.debug('Creating New API')
      apiId = await createApi({ apig, name, description, config })
      this.context.debug(`API With ID ${apiId} Created`)
      this.state.id = apiId
      this.state.region = config.region
      await this.save()
    } else if (!(await apiExists({ apig, apiId }))) {
      throw Error(`The specified api id "${apiId}" does not exist`)
    }

    this.context.status('Creating New Api Template')
    let template = { openapi: "3.0.1", "info": {}, "paths": {}, "components": {} }

    flattenArrays(config)
    if (cors) {
      // This will append an options method to every resource and assign the necessary headers on the response
      this.context.debug(`Enable cors for configured endpoints`)
      endpoints = enableCORS({ endpoints })

    }

    this.context.debug('Update Api Settings')
    template = updateApi({ template, name, description, binaryMediaTypes, minimumCompressionSize })

    this.context.debug('Set Models To template->components')
    template = createModels({ template, models })

    this.context.debug('Create Paths Objects')
    template = await createPaths({ template, endpoints, apig, apiId, lambda, region: config.region })

    // this.context.debug('Create Documentation')
    // template = createDocumentation({ template, endpoints, models })

    const res = await apig.putRestApi({
      body: JSON.stringify(template),
      restApiId: apiId,
      failOnWarnings: false,
      mode: mode
    }).promise()
    this.context.debug(`Applied template to API ${apiId}:` + '\n' + `${res}`)

    this.context.debug('Adding Permissions To Lambda Functions')
    await addLambdaPermissions({ endpoints, apiId, lambda, region: config.region })

    this.context.debug('Deploying')
    await createDeployment({ apig, apiId, deploymentDescription, stage: config.stage })
    console.log(template.paths['/permits'].post);
    
    return template
  }

  async remove(inputs = {}) {
    this.context.status('Removing')
    const defaults = { ...defaultRestAPI, ...inputs, ...this.state }

    const apig = new AWS.APIGateway({
      region: defaults.region,
      credentials: this.context.credentials.aws
    })

    if (defaults.id) {
      this.context.debug(
        `API ID ${defaults.id} found in state. Removing from the ${defaults.region}.`
      )
      await removeApi({ apig, apiId: defaults.id })

      this.context.debug(
        `API with ID ${defaults.id} was successfully removed from the ${defaults.region} region.`
      )
    } else {
      this.context.debug(`No API ID found in state.`)
    }
    this.state = {}
    this.save()
  }
}

module.exports = AwsApiGateway
