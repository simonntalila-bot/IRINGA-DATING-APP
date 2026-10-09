/**
 * Android App Links / iOS Universal Links configuration.
 *
 * The host must be served over HTTPS with a real
 * /.well-known/assetlinks.json (Android) and
 * /.well-known/apple-app-site-association (iOS) file whose
 * sha256 fingerprints match the release keystore. Set the real values in
 * `api.publicUrl` and in EAS/Gradle signing config before shipping.
 */
const config = {
  host: 'app.iringadating.co',
  paths: {
    profile: '/p/:handle',
    place: '/place/:id',
    story: '/story/:id',
    post: '/post/:id',
    invite: '/invite/:code',
  },
};

export default config;
