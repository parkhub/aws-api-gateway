const AWS = require('aws-sdk')
const { mergeDeepRight } = require('ramda')
const { Component } = require('@serverless/components')
const { configChanged, createRoutesApi, updateRoutesApi, deleteApi, createApi } = require('./utils')

const defaults = {
  name: 'serverless',
  region: 'us-east-1'
}

class AwsApiGateway extends Component {
  async default(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)
    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    const { name, template, routes, region } = config
    let outputs

    if (template) {
    } else if (routes) {
      const awsIamRole = await this.load('@serverless/aws-iam-role')
      config.role =
        config.role || (await awsIamRole({ ...config, service: 'apigateway.amazonaws.com' }))

      if (!configChanged(this.state, config)) {
        outputs = this.state
      } else if (inputs.name && !this.state.name) {
        this.cli.status('Creating')
        outputs = await createRoutesApi({
          apig,
          name,
          role: config.role,
          routes,
          stage: this.context.stage,
          region
        })
      } else {
        this.cli.status('Updating')
        outputs = await updateRoutesApi({
          apig,
          name,
          role: config.role,
          routes,
          id: this.state.id,
          stage: this.context.stage,
          region
        })
      }
    } else {
      // create simple API
      if (!this.state.id) {
        outputs = await createApi({ apig, name })
      }
    }

    this.state = outputs
    await this.save()

    this.cli.outputs(outputs)
    return outputs
  }

  async remove(inputs = {}) {
    const { id, apiKeyId, usagePlanId, usagePlanKeyId } = this.state

    if (!id) {
      return
    }

    const config = mergeDeepRight(defaults, inputs)

    const awsIamRole = await this.load('@serverless/aws-iam-role')

    // there's no need to pass names as input
    // since it's saved in the child component state
    await awsIamRole.remove()

    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    this.cli.status('Removing')
    await deleteApi({ apig, id, apiKeyId, usagePlanId, usagePlanKeyId })

    this.state = {}
    await this.save()

    return {}
  }
}

module.exports = AwsApiGateway
