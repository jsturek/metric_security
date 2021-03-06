
let argv = require('minimist')(process.argv.slice(2));

const { URL } = require('url');

//Convert to an absolute URL by default (for example, this will add a trailing slash after the domain if it wasn't provided)
url = new URL(argv._[0]).href;

const puppeteer = require('puppeteer');

let results = {
	'mixed_content_active': {
		fail: false,
		name: 'There must be no active mixed content',
		description: 'Insecure assets such as javascript, iframes, and css that are loaded on https pages are considered to be [active mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content). To fix this issue, change the URLs for these assets to use https. For more information on fixing mixed content, see the [guide on fixing mixed content from Google](https://developers.google.com/web/fundamentals/security/prevent-mixed-content/fixing-mixed-content).',
		data: []
	},
	'mixed_content_passive': {
		fail: false,
		name: 'There should be no passive mixed content',
		description: 'Insecure assets such as images, audio, and video that are loaded on https pages are considered to be [passive mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content). These assets can lead to privacy issues, but are still loaded by browsers. To fix this issue, change the URLs for these assets to use https. For more information on fixing mixed content, see the [guide on fixing mixed content from Google](https://developers.google.com/web/fundamentals/security/prevent-mixed-content/fixing-mixed-content).',
		data: []
	},
	'invalid_cert': {
		fail: false,
		name: 'The page should not have an invalid https certificate',
		description: 'The page should have a valid https certificate. Browsers will display a warning and often prevent people from visiting pages that have an invalid https certificate. You will have to update your certificate to fix this problem.',
		data: []
	},
	'not_https_by_default': {
		fail: false,
		name: 'The page should be https by default',
		description: 'All requests to the http version of the page should redirect to https.',
		data: []
	}
};

function isCertificateError(message) {
	return message.startsWith('SSL Certificate error');
}

let options = {headless: true};

if (argv.sandbox === 'false') {
	options.args = ['--no-sandbox', '--disable-setuid-sandbox'];
}

puppeteer.launch(options).then(async browser => {
	let page = await browser.newPage();
	if (argv.ua) {
		page.setUserAgent(argv.ua);
	}

	page.on('dialog', async dialog => {
		//Auto dismiss dialogs so that the process does not hang waiting on user input.
		await dialog.dismiss();
	});

	//Listen to all requests
	page.on('requestfailed', (request) => {
		//And catch those that are not https
		if (page.url().startsWith('https://')
			&& request.url().startsWith('http://')
			//Don't record requests to html document as 'mixed content'
			&& request.url().replace(/^https?:\/\//i, '//') !== page.url().replace(/^https?:\/\//i, '//')
		) {
			results.mixed_content_active.fail = true;
			results.mixed_content_active.data.push(request.url());
		}
	});

	page.on('requestfinished', (request) => {
		//And catch those that are not https
		if (page.url().startsWith('https://')
			&& request.url().startsWith('http://')
			//Don't record requests to html document as 'mixed content'
			&& request.url().replace(/^https?:\/\//i, '//') !== page.url().replace(/^https?:\/\//i, '//')
		) {
			results.mixed_content_passive.fail = true;
			results.mixed_content_passive.data.push(request.url());
		}
	});

	//Try to load the url
	try {
		await page.goto(url);
	} catch (e) {
		//An exception was thrown, likely due to an invalid cert
		if (isCertificateError(e.message)) {
			results.invalid_cert.fail = true;
			results.invalid_cert.data.push(e.message);
		}

		//fail early
		console.log(JSON.stringify(results));
		process.exit(1);
	}

	if (!page.url().startsWith('https://')) {
		//That page didn't auto-redirect to https, reset the results to clear errors from the http request
		results.mixed_content_active.data = [];
		results.mixed_content_active.fail = false;
		results.mixed_content_passive.data = [];
		results.mixed_content_passive.fail = false;

		//Add a failure
		results.not_https_by_default.fail = true;

		//Now try to reload the page as https
		try {
			await page.goto(url.replace(/^http:\/\//i, 'https://'));
		} catch (e) {
			//An exception was thrown, likely due to an invalid cert
			if (isCertificateError(e.message)) {
				results.invalid_cert.fail = true;
				results.invalid_cert.data.push(e.message);
			}

			//fail early
			console.log(JSON.stringify(results));
			process.exit(1);
		}
	} else {
		//Now try to reload the page as http to see if it redirects to https
		try {
			await page.goto(url.replace(/^https:\/\//i, 'http://'));
		} catch (e) {
			//An exception was thrown, likely due to an invalid cert
			if (isCertificateError(e.message)) {
				results.invalid_cert.fail = true;
				results.invalid_cert.data.push(e.message);
			}

			//fail early
			console.log(JSON.stringify(results));
			process.exit(1);
		}

		if (!page.url().startsWith('https://')) {
			results.not_https_by_default.fail = true;
		}
	}

	//Let the page run for a bit (so we get mixed content)
	await page.waitForTimeout(2500);

	//Now close and print any errors
	browser.close();
	console.log(JSON.stringify(results));
});
