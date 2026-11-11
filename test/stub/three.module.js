// TEST STUB of the three.js API (never shipped): permissive proxies so the client logic can run headless.
function mk(){const t=function(){};const store={};
 const p=new Proxy(t,{get(_,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(typeof k==='symbol')return undefined;if(k in store)return store[k];
   if(k==='length'||k==='count'||k==='x'||k==='y'||k==='z'||k==='w')return 0;return (store[k]=mk());},
  set(_,k,v){store[k]=v;return true;},apply(){return mk();},construct(){return mk();},has(){return true;}});
 return p;}
class Base{constructor(){return mk();}}
export class ACESFilmicToneMapping extends Base{}
export class AdditiveBlending extends Base{}
export class BackSide extends Base{}
export class BoxGeometry extends Base{}
export class BufferAttribute extends Base{}
export class BufferGeometry extends Base{}
export class CanvasTexture extends Base{}
export class CircleGeometry extends Base{}
export class ClampToEdgeWrapping extends Base{}
export class Color extends Base{}
export class ConeGeometry extends Base{}
export class CylinderGeometry extends Base{}
export class DirectionalLight extends Base{}
export class DoubleSide extends Base{}
export class Euler extends Base{}
export class Float32BufferAttribute extends Base{}
export class Fog extends Base{}
export class Group extends Base{}
export class HemisphereLight extends Base{}
export class IcosahedronGeometry extends Base{}
export class InstancedMesh extends Base{}
export class LinearMipmapLinearFilter extends Base{}
export class Matrix4 extends Base{}
export class Mesh extends Base{}
export class MeshBasicMaterial extends Base{}
export class MeshPhongMaterial extends Base{}
export class MeshStandardMaterial extends Base{}
export class NormalBlending extends Base{}
export class Object3D extends Base{}
export class PCFSoftShadowMap extends Base{}
export class PerspectiveCamera extends Base{}
export class PlaneGeometry extends Base{}
export class PointLight extends Base{}
export class Quaternion extends Base{}
export class RepeatWrapping extends Base{}
export class SRGBColorSpace extends Base{}
export class Scene extends Base{}
export class SphereGeometry extends Base{}
export class Sprite extends Base{}
export class SpriteMaterial extends Base{}
export class TorusGeometry extends Base{}
export class Vector2 extends Base{}
export class Vector3 extends Base{}
export class WebGLRenderer extends Base{}
