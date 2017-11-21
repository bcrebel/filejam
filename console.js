#! /usr/bin/env node
const program = require('commander')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)
const prompt = require('prompt')
let { session, init } = require('./index.js')

let schema = {
	properties: {
		email: {
			description: 'Patty email address',
			required: true
		},
		password: {
			description: 'Patty password',
			required: true,
			hidden: true
		}
	}
}


program
	.version(require('./package.json').version)
	.usage('[options] <file>')
	.parse(process.argv);

if(program.args) {
	if(program.args.length < 2) {
		console.log('ERROR: You must provide a Patty sitename and asset directory path')
		process.exit()
	}
	console.time('Asset upload duration')

	let sitename = program.args[0]

	if(db.has('user.name').value() && db.has('user.password').value()) {
		session(`https://patty-${program.args[0]}.hearstapps.com/en`, db.get('user.name').value(), db.get('user.password').value(), `${program.args[1]}`)
		.then(() => {
			init()
		})
	} else {
		prompt.message = ''
		prompt.start()	

		prompt.get(schema, (error, result) => {
			if(error) {
				console.log(error)
			} else {
				db.set('user.name', result.email).write()
				db.set('user.password', result.password).write()
				session(`https://patty-${program.args[0]}.hearstapps.com/en`, db.get('user.name').value(), db.get('user.password').value(), `${program.args[1]}`)
				.then(() => {
					init()
				})
			}
		})
	}
} 



