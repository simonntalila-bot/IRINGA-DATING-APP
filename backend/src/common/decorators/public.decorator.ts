/** Marks a route as reachable without a JWT (health, auth endpoints, webhooks). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, _key?: string | symbol, descriptor?: any): any => {
    if (descriptor) {
      Reflect.defineMetadata(IS_PUBLIC_KEY, true, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, target);
    return target;
  };
};
