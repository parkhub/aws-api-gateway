const AWS = require('aws-sdk')
const { mergeDeepRight } = require('ramda')
const { Component } = require('@serverless/components')
// const { configChanged, createRoutesApi, updateRoutesApi, deleteApi, createApi } = require('./utils')
const { validateEndpoints, createPaths, createMethods, createIntegrations } = require('./next')

const defaults = {
  apiId: 'hh9s891g8d',
  endpoints: [
    {
      path: 'posts/any',
      method: 'any',
      function: 'abc'
    }
    // {
    //   path: 'posts/',
    //   method: 'post',
    //   function: 'abc'
    // }
  ]
}
class AwsApiGateway extends Component {
  async default(inputs = {}) {
    this.cli.status('Deploying')

    const fn = await this.load('@serverless/aws-lambda')

    const lambdaOutputs = await fn({
      name: 'apig-test-4',
      code: './code',
      handler: 'index.hello'
    })

    const config = mergeDeepRight(defaults, inputs)

    const apig = new AWS.APIGateway({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    const lambda = new AWS.Lambda({
      region: config.region,
      credentials: this.context.credentials.aws
    })

    const { state } = this
    const { apiId } = config

    let endpoints = await validateEndpoints({ apig, apiId, endpoints: config.endpoints, state })

    endpoints = await createPaths({ apig, apiId, endpoints })
    endpoints = await createMethods({ apig, apiId, endpoints })

    endpoints[0].function = lambdaOutputs.arn

    this.state.endpoints = endpoints
    await this.save()

    const res = await createIntegrations({ apig, lambda, apiId, endpoints })

    // console.log(res)
  }

  // async remove(inputs = {}) {
  //   const { id } = this.state
  //
  //   if (!id) {
  //     return
  //   }
  //
  //   const config = mergeDeepRight(defaults, inputs)
  //
  //   const awsIamRole = await this.load('@serverless/aws-iam-role')
  //
  //   // there's no need to pass names as input
  //   // since it's saved in the child component state
  //   await awsIamRole.remove()
  //
  //   const apig = new AWS.APIGateway({
  //     region: config.region,
  //     credentials: this.context.credentials.aws
  //   })
  //
  //   this.cli.status('Removing')
  //   await deleteApi({ apig, id })
  //
  //   this.state = {}
  //   await this.save()
  //
  //   return {}
  // }
}

module.exports = AwsApiGateway
