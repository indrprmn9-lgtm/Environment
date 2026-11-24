declare module 'shpjs' {
  const shp: (buffer: ArrayBuffer | string) => Promise<unknown>;
  export default shp;
}
