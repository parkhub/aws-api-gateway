module.exports.hello = async (e) => {
  console.log(e)
  return {
    statusCode: 200,
    body: 'hello'
  }
}
