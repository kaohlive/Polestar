'use strict';

const { Driver } = require('homey');
const axios = require('axios');
const AthomCloudAPI = require('homey-api/lib/AthomCloudAPI');

class PolestarBetaDriver extends Driver {
    async onInit() {
        this.homey.app.log(this.homey.__({ en: 'Polestar Driver CSV ᴮᴱᵀᴬ has been initialized', no: 'Polestar Driver CSV ᴮᴱᵀᴬ har blitt initialisert' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG');

        this.homeyId = await this.homey.cloud.getHomeyId();
        this.vehicles = [];
        this._tripEndedFlow = this.homey.flow.getDeviceTriggerCard('tripEnded');
        this.cloudApi = new AthomCloudAPI({
            clientId: '64691b4358336640a5ecee5c',
            clientSecret: 'ed09f559ae12b1522d00431f0bf7c5755603c41e',
            redirectUrl: 'https://cli.athom.com',
        });
    }

    async onPair(session) {
        this.vehicles = [];

        this.homey.app.log(this.homey.__({ en: 'Started pairing for Polestar 2', no: 'Starter paring for Polestar 2' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG');
        session.setHandler('createWebhook', async (args) => {
            try {
                // Generer en secret for webhook og lagre den i settings
                const id = args.id;
                const secret = args.secret;
                const data = {
                    deviceId: `Polestar2CarStatsViewer.${args.slug}`,
                }
                const webhook = await this.homey.cloud.createWebhook(id, secret, data);
                const webhookUrl = `https://webhooks.athom.com/webhook/${webhook.id}/?homey=${this.homeyId}`;

                const pingWebhook = await axios.get(webhookUrl);
                if (pingWebhook.status === 200 && pingWebhook.data === 'ok') {
                    this.homey.app.log(this.homey.__({ en: 'Successfully pinged webhook', no: 'Klarte å pinge webhook' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG');
                } else {
                    this.homey.app.log(this.homey.__({ en: 'Failed to ping webhook', no: 'Klarte ikke å ping webhook' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'ERROR');
                    return { success: false, error: 'Failed to ping webhook' };
                }

                this.vehicles.push({
                    name: 'Polestar 2 ᴮᴱᵀᴬ',
                    data: {
                        id: `Polestar2CarStatsViewer.${args.slug}`,
                        webhook: JSON.stringify(webhook),
                    },
                    settings: {
                        polestar_webhook: webhookUrl,
                        webhook_url_short: args.url_short,
                        webhook_slug: args.slug,
                        webhook_id: id,
                        webhook_secret: secret,
                    }
                });

                // try {
                //     const registerPolestarUser = await axios.post(`https://homey.crdx.us/register/${args.slug}`, {
                //         slug: args.slug,
                //         homeyId: this.homeyId,
                //         webhookId: webhook.id,
                //         webhookSecret: webhook.secret,
                //         webhookUrl: webhookUrl,
                //         shortWebhookUrl: args.url_short,
                //     });

                //     if (registerPolestarUser.status === 200 && registerPolestarUser.data.success) {
                //         this.homey.app.log(this.homey.__({
                //             en: 'Successfully registered user for webhook',
                //             no: 'Klarte å registrere bruker for webhook'
                //         }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG', registerPolestarUser.data);
                //     }
                // } catch (error) {
                //     this.homey.app.log(this.homey.__({
                //         en: 'Failed to register user for webhook',
                //         no: 'Klarte ikke å registrere bruker for webhook'
                //     }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'ERROR', error.message);
                //     return { success: false, error: error.message };
                // }

                // this.webhookUrl = webhookUrl;

                this.homey.app.log(this.homey.__({ en: 'Webhook created', no: 'Webhook opprettet' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG');
                return { success: true };
            } catch (error) {
                this.homey.app.log(this.homey.__({ en: 'Failed to create webhook', no: 'Klarte ikke å opprette webhook' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'ERROR');
                this.log(error.message);
                return { success: false, error: error.message };
            }
        });

        session.setHandler('getHomeyId', async () => {
            return this.homeyId;
        });

        session.setHandler('getWebhook', async (data) => {
            return this.webhookUrl;
        });

        session.setHandler('list_devices', async () => {
            return await this.onPairListDevices(session);
        });
    }

    async onPairListDevices() {
        this.homey.app.log(this.homey.__({ en: 'Vehicles ready to be added:', no: 'Kjøretøy klare til å bli lagt til:' }), 'Polestar Driver CSV ᴮᴱᵀᴬ', 'DEBUG', this.vehicles);
        return this.vehicles;
    }

}

module.exports = PolestarBetaDriver;
