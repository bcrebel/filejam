
const request = require('request')
const cheerio = require('cheerio')
const sizeOf = require('image-size')
const j = request.jar()
const fs = require('fs')
const path = require('path')
const readChunk = require('read-chunk')
const fileType = require('file-type')
const junk = require('junk')
const _ = require('lodash')
const sortKeys = require('sort-keys');
const { Builder, By, Key, until } = require('selenium-webdriver')
const chromeDriver = require('selenium-webdriver/chrome')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db.json')
const db = low(adapter)
const handlebars = require('handlebars')
const open = require('open')
const driver = new Builder()
	.forBrowser('chrome')
	.build()
			
let settings = {}
let result = {}
let logVideo = false

function createPage(data) {
	fs.readFile(path.join(__dirname, 'template.html'), 'utf-8', (error, source) => {

		let template = handlebars.compile(source)

		let html = template(data)

		fs.writeFile(path.join(__dirname, 'index.html'), html, function(err) {
	    if(err) {
	      return console.log(err);
	    }
		})

		open(path.join(__dirname, 'index.html'))
	})
}

let assetUpload = (file, idx, csrf, type, final) => { // STEP 4

	// Copy of calculateCrops method from Edit UI
	function calculateCrops(file) {
		let dimensions = sizeOf(file);
			
		// Store references to crops, image width and height
		let crops = [[1,1],[2,1],[16,9],[4,3],[8,1],[5,1],[3,1],[8,10],[6,4],[4,6],[10,2],[10,3],[10,5],[9,16]]
		let imageWidth = dimensions.width
		let imageHeight = dimensions.height
		let fileAttributes = {}

		fileAttributes['width'] = imageWidth
		fileAttributes['height'] = imageHeight
		fileAttributes.crops = {}

		// Loop through all available crops, calculating each in turn
		crops.forEach(function(crop) {
			let cropWidth = crop[0],
			cropHeight = crop[1],
			wP = ((imageHeight * cropWidth) / cropHeight) / imageWidth, // Percentage width based on AR
			hP = ((imageWidth * cropHeight) / cropWidth) / imageHeight, // Percentage height based on AR
			nP;

			// Choose type of crop based on image dimensions
			if (imageWidth >= imageHeight) {
				crop = wP < 1 ? "{$nP}xw:1xh;center,top" : "1xw:{$nP}xh;center,top";
				nP = wP < 1 ? wP : hP;
			} else {
				crop = hP < 1 ? "1xw:{$nP}xh;center,top" : "{$nP}xw:1xh;center,top";
				nP = hP < 1 ? hP : wP;
			}

			// Store crop, keyed off aspect ratio
			fileAttributes.crops[cropWidth + "x" + cropHeight] = crop.replace("{$nP}", nP)
		})

		return JSON.stringify(fileAttributes) 
	}

	file = path.resolve(file)

	// If file type is image, post file to Patty
	if(type === 'image') { 
		result.images = {}

		let formData = {
			_csrf: csrf, 
			type: 'image',
			file: fs.createReadStream(file),
			fileAttributes: calculateCrops(file)
		}

		request.post({ 
			url: settings.ajaxUploadUrl,
			jar: j,
			formData: formData
		}, function(error, response, body) {
			console.log("Uploading an image...")

			if(error) {
				result.images[`${file.replace(/^.*[\\\/]/, '')}`] = 'image upload errored'
			} else {
				result.images[`${file.replace(/^.*[\\\/]/, '')}`] = JSON.parse(body).data.hips_url
				
				// If the last image has been uploaded and there are no videos
				if(final && logVideo === false) {
					result.images = sortKeys(result.images)
					console.log(result)
					console.timeEnd('Asset upload duration');
					createPage(result)
				}
			}
		})
	}

	// If file type is video, upload to Patty with Selenium WebDriver
	if(type === 'video') {

		result.videos = {}

		function uploadVid(vid) {
			driver.get(settings.videoUrl)
			driver.sleep(5000)
			driver.wait(until.elementLocated(By.id('video-file-asset'))).then(() => {
			
				driver.findElement(By.id('video-file-asset')).sendKeys(vid)
				.then(() => {
					console.log('Uploading a video...') 
				})

				driver.wait(until.elementLocated(By.className('encoding-version'))).then(() => {
				
					// Get url once transcoding is complete
					driver.getCurrentUrl()	

					// Grab Video ID
					.then((url) => {
						// Maybe create a promise that resolves when vidlinks equals the length of videos array
						//then do nighthawk on each of those

						// Visit Nitehawk 
						function getNitehawk(vidId) { 
							let vidLinks = []

							request.get({
								url: `https://nitehawk.hearst.io/videos/${vidId}`
								}, function(error, response, body) {
								console.log('Checking if transcoding is complete...')
								
								if(response.statusCode == '200') {
									vidLinks.push(`${JSON.parse(body).transcodings[0].full_url}`)
									vidLinks.push(`${JSON.parse(body).transcodings[2].full_url}`)

								} else {
									vidLinks.push('video upload errored')
									console.log(`Error uploading file ${file}`)
								}

								// Add file key and links value to final videos object 
								result.videos[`${file.replace(/^.*[\\\/]/, '')}`] = vidLinks
								
								if(final) { 
									result.videos = sortKeys(result.videos);
									if(result.images != undefined) result.images = sortKeys(result.images)
									console.log(result);
									console.timeEnd('Asset upload duration');
									createPage(result);
									driver.quit();
								}
							})
						}

						getNitehawk(url.split('/').pop())
					})
				})
			})
		}

		function logIn() { 
			// Logging into Patty with Selenium...
			driver.get(settings.urlLogin)
			driver.findElement(By.name('email')).sendKeys(`${settings.username}`, Key.RETURN)
			driver.findElement(By.name('password')).sendKeys(`${settings.password}`, Key.RETURN)
		}

		if(idx === 0) logIn() 
		uploadVid(file) 
	} 
}

let arrangeFiles = (input, csrf) => { 
	
	let filelist = []
	let images = []
	let videos = [] 

	// Return an array containing all provided files 
	function walkSync(dir) {
		fs.readdirSync(dir).forEach(file => {
			if(junk.not(file)) { // Check for .DS_Store files
				filelist = fs.statSync(path.join(dir, file)).isDirectory()
				? walkSync(path.join(dir, file), filelist)
				: filelist.concat(path.join(dir, file)) 
			} 
		})

		return filelist
	}


	if(fs.lstatSync(settings.input).isDirectory()) { // if input is a directory, add each file to filelist array
		walkSync(settings.input)
	} else if(fs.lstatSync(settings.input).isFile()) { // if input is a file, add the file to filelist array
		filelist.push(settings.input)
	} 

	if(filelist.length === 0) console.log('ERROR: No assets found')
	
	// Separate files by file type
	filelist.forEach((file) => {
		let buffer = readChunk.sync(file, 0, 4100)
		let mime = fileType(buffer) != null ? fileType(buffer).mime.toString() : null
		let typeImage = new RegExp('image')
		let typeVideo = new RegExp('video')

		if(typeImage.test(mime)) { // If file type is image, push into images array
			images.push(file)
		} else if(typeVideo.test(mime)) { // If file type is video, push into videos array
			logVideo = true
			videos.push(file) 
		} 
	})

	// Upload each image file
	images.forEach((file, idx) => {
		let final = false
		if (idx === images.length - 1) final = true
		assetUpload(file, idx, csrf, 'image', final)
	})

	// Upload each video file
	videos.forEach((file, idx) => {
		let final = false
		if (idx === videos.length - 1) final = true
		assetUpload(file, idx, csrf, 'video', final)
	})
}

let init = () => {

	// Grab cookies from response header
	function jarUpdate(response, url) {
		if(response.headers['set-cookie'] instanceof Array) {
			let cookies = response.headers['set-cookie'].map(function(cookie) {
				return cookie.slice(0, cookie.indexOf(';'))
			})

			cookies.forEach(function(cookie) {
				j.setCookie(cookie, url)
			})

		} else if(response.headers['set-cookie']) {
			let cookie = response.headers['set-cookie'].slice(0, response.headers['set-cookie'].indexOf(';'))
			j.setCookie(cookie, url)
		} else {
			console.log('ERROR: Invalid login credentials, rerun "filejam sitename path/to/directory"')
			db.unset('user.name').write()
			db.unset('user.password').write()
			process.exit()
		}
	}

	// Log into Patty
	function submitForm(csrf) {
		request.post({ 
			url: settings.urlLogin, 
			jar: j,
			form: {
				_csrf: csrf, 
				email: settings.username, 
				password: settings.password, 
				submit: 'Log In'
			}
		}, function(error, response, body) {
			if(error) {
				console.log(error)
			} else {
				// Update new PHPSESSID	
				jarUpdate(response, settings.url) 
				arrangeFiles(settings.input, csrf)
			}
		})
	}

	// Parse csrf token from login form
	function getCSRF(body) {
		console.log('Logging into Patty...')
		let $ = cheerio.load(body)
		let csrf = $('input[name="_csrf"]').attr('value')
		
		// Pass csrf to subsequent requests
		submitForm(csrf) 
	}

	// Get Patty Login Page 
	request.get({ 
		url: settings.urlLogin, 
		jar: j
	}, function (error, response, body) {
		if(error) {
			console.log(`ERROR: ${error.hostname} is not a valid patty site url`)
			process.exit()
		}

		getCSRF(body)
	})
}

let session = (url, username, password, input) => {
	let _settings = { url, username, password, input }
	settings = Object.assign(settings, _settings)

	settings.urlLogin = url + '/login'
	settings.ajaxUploadUrl =  url + '/ajax/assetupload'
	settings.videoUrl = url + '/videos/create'

	return new Promise(function(resolve, reject) {
		if(settings.url && settings.username && settings.password) {
			resolve('Success!');
		} else {
		reject('Failure!');
		}
	}) 
}

module.exports = { session, init }

