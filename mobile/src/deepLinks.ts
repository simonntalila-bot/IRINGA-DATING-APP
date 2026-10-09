/**
 * Deep link handling.
 *
 * Supported routes (spec section 17):
 *   /p/:handle        shared profile
 *   /place/:id        shared place
 *   /story/:id        shared story
 *   /post/:id         shared post
 *   /invite/:code     referral invite
 *
 * Android App Links and iOS Universal Links need a verified domain:
 *   /.well-known/assetlinks.json
 *   /.well-known/apple-app-site-association
 * Both must list the sha256 fingerprint of the RELEASE keystore. Until the app
 * is listed, the browser opens the web landing page and the user installs the
 * app; on first launch the original link is replayed (deferred deep link).
 */

export type DeepLinkTarget =
  | { kind: 'profile'; handle: string }
  | { kind: 'place'; id: string }
  | { kind: 'story'; id: string }
  | { kind: 'post'; id: string }
  | { kind: 'invite'; code: string }
  | { kind: 'conversation'; conversationId: string };

export interface DeepLink {
  target: DeepLinkTarget;
  /** Link captured before authentication, replayed after login. */
  deferred: boolean;
}

export function parseDeepLink(url: string, authenticated: boolean): DeepLink | null {
  const withoutScheme = url.replace(/^https?:\/\/[^/]+/i, '').replace(/^iringadating:\/\//i, '/');
  const [pathPart] = withoutScheme.split('?');
  const segments = pathPart.split('/').filter(Boolean);

  if (segments.length === 0) return null;

  const [section, id] = segments;
  const deferred = !authenticated;

  switch (section) {
    case 'p':
      return id ? { target: { kind: 'profile', handle: id }, deferred } : null;
    case 'place':
      return id ? { target: { kind: 'place', id }, deferred } : null;
    case 'story':
      return id ? { target: { kind: 'story', id }, deferred } : null;
    case 'post':
      return id ? { target: { kind: 'post', id }, deferred } : null;
    case 'invite':
      return id ? { target: { kind: 'invite', code: id }, deferred } : null;
    case 'chat':
      return id ? { target: { kind: 'conversation', conversationId: id }, deferred } : null;
    default:
      return null;
  }
}

/**
 * Shareable profile URL. The handle is a random public identifier - never the
 * internal user id and never any private profile data.
 */
export function profileShareUrl(webDomain: string, handle: string): string {
  return `${webDomain.replace(/\/$/, '')}/p/${handle}`;
}
