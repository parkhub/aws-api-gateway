const AWS = require('aws-sdk')
const { mergeDeepRight } = require('ramda')
const { Component } = require('@serverless/components')
const { configChanged, createApi, updateApi, deleteApi } = require('./utils')

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

    const awsIamRole = await this.load('AwsIamRole')
    config.role = config.role || (await awsIamRole(config))

    const { name, role, routes } = config

    let outputs
    if (!configChanged(this.state, config)) {
      outputs = this.state
    } else if (inputs.name && !this.state.name) {
      this.cli.status('Creating')
      outputs = await createApi({ apig, name, role, routes })
    } else {
      this.cli.status('Updating')
      outputs = await updateApi({
        apig,
        name,
        role,
        routes,
        id: this.state.id
      })
    }

    this.state = outputs
    await this.save()

    this.cli.outputs({ id: outputs.id, url: outputs.url, urls: outputs.urls })
    return outputs
  }

  async remove(inputs = {}) {
    const config = mergeDeepRight(defaults, inputs)
    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    const { id } = this.state
    this.cli.status('Removing')
    await deleteApi({ apig, id })

    this.state = {}
    await this.save()

    return {}
  }
}

module.exports = AwsApiGateway
