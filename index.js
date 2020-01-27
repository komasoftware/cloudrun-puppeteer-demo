// tracing
if (process.env.NODE_ENV === 'production') {
    require('@google-cloud/trace-agent').start();
}
// nconf
const nconf = require('nconf')
nconf.argv()
    .env()
    .file({ file: 'config.json' })
    .defaults({
        TOPIC_SCRAPE_RESULTS: `projects/${process.env.PROJECT}/topics/scrape-demo`
    });

// pubsub
const { PubSub } = require('@google-cloud/pubsub');
const pubsub = new PubSub();

// express
const express = require('express');
const app = express();

// puppeteer in stealth modus
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin());
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const publishResults = async (url, data, topicName, errorMessage) => {
    try {
        if (errorMessage) {
            console.error(`scrape_demo: ${url} scrape error=${errorMessage}`);
        }
        const customAttributes = {
            url: url,
            errorMessage: errorMessage || ""
        };
        const dataBuffer = Buffer.from(JSON.stringify(data));
        const messageId = await pubsub.topic(topicName).publish(dataBuffer, customAttributes);
        console.info(`scrape_demo: ${url} published message=${messageId}`);
    }
    catch (ex) {
        console.error(`scrape_demo: ${url} publishResults exception=${ex.message}.`, ex);
    }
}

const scrape = (url) => {
    console.info(`scrape_demo: scraping ${url}`);
    return new Promise(async (resolve, reject) => {
        let browser = null;
        try {
            browser = await puppeteer.launch({
                headless: true,
                ignoreHTTPSErrors: true
            });
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
            let hotelData = await page.evaluate(() => {
                let hotels = [];
                // get the hotel elements
                let hotelsElms = document.querySelectorAll('div.sr_property_block[data-hotelid]');
                // get the hotel data
                hotelsElms.forEach((hotelelement) => {
                    let hotelJson = {};
                    try {
                        hotelJson.name = hotelelement.querySelector('span.sr-hotel__name').innerText;
                        hotelJson.reviews = hotelelement.querySelector('span.review-score-widget__subtext').innerText;
                        hotelJson.rating = hotelelement.querySelector('span.review-score-badge').innerText;
                        if (hotelelement.querySelector('strong.price')) {
                            hotelJson.price = hotelelement.querySelector('strong.price').innerText;
                        }
                    }
                    catch (exception) {

                    }
                    hotels.push(hotelJson);
                });
                return hotels;
            });

            return resolve(hotelData);
        } catch (e) {
            return reject(e);
        } finally {
            browser.close();
        }
    });
}

app.get('/scrape', async (req, res) => {
    const default_url = `https://www.booking.com/searchresults.en-gb.html?label=gen173nr-1FCAEoggI46AdIM1gEaBWIAQGYAQm4ARnIAQzYAQHoAQH4AQuIAgGoAgO4Ao_iuvEFwAIB&sid=e7c1d380dd81ce19109bbfc2a22a7e3b&sb=1&sb_lp=1&src=index&src_elem=sb&error_url=https%3A%2F%2Fwww.booking.com%2Findex.en-gb.html%3Flabel%3Dgen173nr-1FCAEoggI46AdIM1gEaBWIAQGYAQm4ARnIAQzYAQHoAQH4AQuIAgGoAgO4Ao_iuvEFwAIB%3Bsid%3De7c1d380dd81ce19109bbfc2a22a7e3b%3Bsb_price_type%3Dtotal%26%3B&sr_autoscroll=1&ss=Amsterdam%2C+Noord-Holland%2C+Netherlands&is_ski_area=0&checkin_year=2020&checkin_month=2&checkin_monthday=5&checkout_year=2020&checkout_month=2&checkout_monthday=6&group_adults=1&group_children=0&no_rooms=1&b_h4u_keep_filters=&from_sf=1&ss_raw=amsterdam&ac_position=0&ac_langcode=en&ac_click_type=b&dest_id=-2140479&dest_type=city&iata=AMS&place_id_lat=52.372898&place_id_lon=4.893&search_pageview_id=b60944878aed0020&search_selected=true`;
    const url = req.query.url || default_url;
    console.info(`scrape_demo: /scrape received for ${url}`);
    url && await scrape(url)
        .then(
            (data) => {
                publishResults(url, data || [], nconf.get('TOPIC_SCRAPE_RESULTS'));
                res.send(`${JSON.stringify(data)} done.`);
            }).catch((exception) => {
                publishResults(url, [], nconf.get('TOPIC_SCRAPE_RESULTS'), exception.message);
                res.send(`error=${exception.message}.`);
            });
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log('scrape_demo: ready to process incoming requests.', port);
});
