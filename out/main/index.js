"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const fs = require("fs");
const fbxParser = require("fbx-parser");
const child_process = require("child_process");
const util = require("util");
const os = require("os");
const readline = require("readline");
const archiver = require("archiver");
const STEP_NAMES = [
  "Parsing 3D model",
  "Processing textures",
  "Generating drawable XML",
  "Generating collision",
  "Converting to GTA V binary",
  "Packaging FiveM resource"
];
function emitProgress(callback, step, message) {
  callback({
    step,
    totalSteps: STEP_NAMES.length,
    stepName: STEP_NAMES[step] || "Processing",
    message,
    percent: Math.round((step + 0.5) / STEP_NAMES.length * 100)
  });
}
function computeBoundingBox(mesh) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      min.x = Math.min(min.x, v.position.x);
      min.y = Math.min(min.y, v.position.y);
      min.z = Math.min(min.z, v.position.z);
      max.x = Math.max(max.x, v.position.x);
      max.y = Math.max(max.y, v.position.y);
      max.z = Math.max(max.z, v.position.z);
    }
  }
  if (min.x === Infinity) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  return { min, max };
}
function computeBoundingSphere(bb) {
  const center = {
    x: (bb.min.x + bb.max.x) / 2,
    y: (bb.min.y + bb.max.y) / 2,
    z: (bb.min.z + bb.max.z) / 2
  };
  const dx = bb.max.x - bb.min.x;
  const dy = bb.max.y - bb.min.y;
  const dz = bb.max.z - bb.min.z;
  const radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
  return { center, radius };
}
function computeVertexNormal(p0, p1, p2) {
  const ax = p1.x - p0.x;
  const ay = p1.y - p0.y;
  const az = p1.z - p0.z;
  const bx = p2.x - p0.x;
  const by = p2.y - p0.y;
  const bz = p2.z - p0.z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return { x: 0, y: 1, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}
function ensureNormals(mesh) {
  for (const geo of mesh.geometries) {
    let hasNormals = true;
    for (const v of geo.vertices) {
      if (v.normal.x === 0 && v.normal.y === 0 && v.normal.z === 0) {
        hasNormals = false;
        break;
      }
    }
    if (hasNormals) continue;
    for (let i = 0; i < geo.indices.length; i += 3) {
      const i0 = geo.indices[i];
      const i1 = geo.indices[i + 1];
      const i2 = geo.indices[i + 2];
      const v0 = geo.vertices[i0];
      const v1 = geo.vertices[i1];
      const v2 = geo.vertices[i2];
      const n = computeVertexNormal(v0.position, v1.position, v2.position);
      v0.normal = n;
      v1.normal = n;
      v2.normal = n;
    }
  }
}
function ensureTexCoords(mesh) {
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      if (!v.texCoord) {
        v.texCoord = { u: 0, v: 0 };
      }
    }
  }
}
function normalizeMesh(mesh) {
  ensureNormals(mesh);
  ensureTexCoords(mesh);
  mesh.boundingBox = computeBoundingBox(mesh);
  mesh.boundingSphere = computeBoundingSphere(mesh.boundingBox);
  return mesh;
}
function parseObjFile(content) {
  const positions = [];
  const normals = [];
  const texCoords = [];
  const faces = [];
  let mtlFile = null;
  let currentGroup = "default";
  const groups = ["default"];
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];
    switch (cmd) {
      case "v":
        positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        break;
      case "vn":
        normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        break;
      case "vt":
        texCoords.push([parseFloat(parts[1]), parseFloat(parts[2]) ?? 0]);
        break;
      case "f": {
        const faceVerts = [];
        for (let i = 1; i < parts.length; i++) {
          const indices = parts[i].split("/");
          faceVerts.push({
            v: parseInt(indices[0]) - 1,
            vt: indices[1] ? parseInt(indices[1]) - 1 : -1,
            vn: indices[2] ? parseInt(indices[2]) - 1 : -1
          });
        }
        for (let i = 1; i < faceVerts.length - 1; i++) {
          faces.push({
            group: currentGroup,
            verts: [faceVerts[0], faceVerts[i], faceVerts[i + 1]]
          });
        }
        break;
      }
      case "usemtl":
      case "g":
      case "o":
        currentGroup = parts.slice(1).join(" ") || "default";
        if (!groups.includes(currentGroup)) groups.push(currentGroup);
        break;
      case "mtllib":
        mtlFile = parts.slice(1).join(" ");
        break;
    }
  }
  return { positions, normals, texCoords, faces, mtlFile, groups };
}
function parseMtlFile(content) {
  const materials = /* @__PURE__ */ new Map();
  let current = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const cmd = parts[0];
    switch (cmd) {
      case "newmtl":
        current = {
          name: parts.slice(1).join(" "),
          diffuseColor: [0.8, 0.8, 0.8, 1],
          diffuseMap: null,
          normalMap: null,
          specularMap: null
        };
        materials.set(current.name, current);
        break;
      case "Kd":
        if (current) {
          current.diffuseColor = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]), 1];
        }
        break;
      case "map_Kd":
        if (current) current.diffuseMap = parts.slice(1).join(" ");
        break;
      case "map_Bump":
      case "bump":
        if (current) current.normalMap = parts.slice(1).join(" ");
        break;
      case "map_Ks":
        if (current) current.specularMap = parts.slice(1).join(" ");
        break;
    }
  }
  return materials;
}
class ObjModelParser {
  async parse(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    const dir = path.dirname(filePath);
    const objData = parseObjFile(content);
    let mtlMaterials = /* @__PURE__ */ new Map();
    if (objData.mtlFile) {
      const mtlPath = path.join(dir, objData.mtlFile);
      if (fs.existsSync(mtlPath)) {
        const mtlContent = fs.readFileSync(mtlPath, "utf-8");
        mtlMaterials = parseMtlFile(mtlContent);
      }
    }
    const groupedFaces = /* @__PURE__ */ new Map();
    for (const face of objData.faces) {
      const group = face.group;
      if (!groupedFaces.has(group)) groupedFaces.set(group, []);
      groupedFaces.get(group).push(face);
    }
    const materials = [];
    const geometries = [];
    let matIndex = 0;
    for (const [groupName, groupFaces] of groupedFaces) {
      const mtlData = mtlMaterials.get(groupName);
      const mat = {
        name: groupName,
        diffuseTexturePath: mtlData?.diffuseMap ? path.resolve(dir, mtlData.diffuseMap) : null,
        normalTexturePath: mtlData?.normalMap ? path.resolve(dir, mtlData.normalMap) : null,
        specularTexturePath: mtlData?.specularMap ? path.resolve(dir, mtlData.specularMap) : null,
        diffuseColor: mtlData ? { x: mtlData.diffuseColor[0], y: mtlData.diffuseColor[1], z: mtlData.diffuseColor[2], w: mtlData.diffuseColor[3] } : { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: "default.sps"
      };
      materials.push(mat);
      const vertices = [];
      const indices = [];
      const vertexMap = /* @__PURE__ */ new Map();
      for (const face of groupFaces) {
        for (const fv of face.verts) {
          const key = `${fv.v}/${fv.vt}/${fv.vn}`;
          let idx = vertexMap.get(key);
          if (idx === void 0) {
            const pos = objData.positions[fv.v] || [0, 0, 0];
            const norm = fv.vn >= 0 && objData.normals[fv.vn] ? objData.normals[fv.vn] : [0, 0, 0];
            const tc = fv.vt >= 0 && objData.texCoords[fv.vt] ? objData.texCoords[fv.vt] : [0, 0];
            idx = vertices.length;
            vertices.push({
              position: { x: pos[0], y: pos[1], z: pos[2] },
              normal: { x: norm[0], y: norm[1], z: norm[2] },
              texCoord: { u: tc[0], v: 1 - tc[1] }
              // Flip V for GTA
            });
            vertexMap.set(key, idx);
          }
          indices.push(idx);
        }
      }
      geometries.push({
        materialIndex: matIndex,
        vertices,
        indices
      });
      matIndex++;
    }
    if (geometries.length === 0 && objData.faces.length > 0) {
      const vertices = [];
      const indices = [];
      const vertexMap = /* @__PURE__ */ new Map();
      for (const face of objData.faces) {
        for (const fv of face.verts) {
          const key = `${fv.v}/${fv.vt}/${fv.vn}`;
          let idx = vertexMap.get(key);
          if (idx === void 0) {
            const pos = objData.positions[fv.v] || [0, 0, 0];
            const norm = fv.vn >= 0 && objData.normals[fv.vn] ? objData.normals[fv.vn] : [0, 0, 0];
            const tc = fv.vt >= 0 && objData.texCoords[fv.vt] ? objData.texCoords[fv.vt] : [0, 0];
            idx = vertices.length;
            vertices.push({
              position: { x: pos[0], y: pos[1], z: pos[2] },
              normal: { x: norm[0], y: norm[1], z: norm[2] },
              texCoord: { u: tc[0], v: 1 - tc[1] }
            });
            vertexMap.set(key, idx);
          }
          indices.push(idx);
        }
      }
      materials.push({
        name: "default",
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: "default.sps"
      });
      geometries.push({ materialIndex: 0, vertices, indices });
    }
    const mesh = {
      name: path.basename(filePath, path.extname(filePath)),
      geometries,
      materials,
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0 }
    };
    return normalizeMesh(mesh);
  }
}
var EventDispatcher = class {
  _listeners = {};
  addEventListener(type, listener) {
    const listeners = this._listeners;
    if (listeners[type] === void 0) listeners[type] = [];
    if (listeners[type].indexOf(listener) === -1) listeners[type].push(listener);
    return this;
  }
  removeEventListener(type, listener) {
    const listenerArray = this._listeners[type];
    if (listenerArray !== void 0) {
      const index = listenerArray.indexOf(listener);
      if (index !== -1) listenerArray.splice(index, 1);
    }
    return this;
  }
  dispatchEvent(event) {
    const listenerArray = this._listeners[event.type];
    if (listenerArray !== void 0) {
      const array = listenerArray.slice(0);
      for (let i = 0, l = array.length; i < l; i++) array[i].call(this, event);
    }
    return this;
  }
  dispose() {
    for (const key in this._listeners) delete this._listeners[key];
  }
};
var GraphEdge = class {
  _disposed = false;
  _name;
  _parent;
  _child;
  _attributes;
  constructor(_name, _parent, _child, _attributes = {}) {
    this._name = _name;
    this._parent = _parent;
    this._child = _child;
    this._attributes = _attributes;
    if (!_parent.isOnGraph(_child)) throw new Error("Cannot connect disconnected graphs.");
  }
  /** Name (attribute name from parent {@link GraphNode}). */
  getName() {
    return this._name;
  }
  /** Owner node. */
  getParent() {
    return this._parent;
  }
  /** Resource node. */
  getChild() {
    return this._child;
  }
  /**
  * Sets the child node.
  *
  * @internal Only {@link Graph} implementations may safely call this method directly. Use
  * 	{@link Property.swap} or {@link Graph.swapChild} instead.
  */
  setChild(child) {
    this._child = child;
    return this;
  }
  /** Attributes of the graph node relationship. */
  getAttributes() {
    return this._attributes;
  }
  /** Destroys a (currently intact) edge, updating both the graph and the owner. */
  dispose() {
    if (this._disposed) return;
    this._parent._destroyRef(this);
    this._disposed = true;
  }
  /** Whether this link has been destroyed. */
  isDisposed() {
    return this._disposed;
  }
};
var Graph = class extends EventDispatcher {
  _emptySet = /* @__PURE__ */ new Set();
  _edges = /* @__PURE__ */ new Set();
  _parentEdges = /* @__PURE__ */ new Map();
  _childEdges = /* @__PURE__ */ new Map();
  /** Returns a list of all parent->child edges on this graph. */
  listEdges() {
    return Array.from(this._edges);
  }
  /** Returns a list of all edges on the graph having the given node as their child. */
  listParentEdges(node) {
    return Array.from(this._childEdges.get(node) || this._emptySet);
  }
  /** Returns a list of parent nodes for the given child node. */
  listParents(node) {
    const parentSet = /* @__PURE__ */ new Set();
    for (const edge of this.listParentEdges(node)) parentSet.add(edge.getParent());
    return Array.from(parentSet);
  }
  /** Returns a list of all edges on the graph having the given node as their parent. */
  listChildEdges(node) {
    return Array.from(this._parentEdges.get(node) || this._emptySet);
  }
  /** Returns a list of child nodes for the given parent node. */
  listChildren(node) {
    const childSet = /* @__PURE__ */ new Set();
    for (const edge of this.listChildEdges(node)) childSet.add(edge.getChild());
    return Array.from(childSet);
  }
  disconnectParents(node, filter) {
    for (const edge of this.listParentEdges(node)) if (!filter || filter(edge.getParent())) edge.dispose();
    return this;
  }
  /**********************************************************************************************
  * Internal.
  */
  /**
  * Creates a {@link GraphEdge} connecting two {@link GraphNode} instances. Edge is returned
  * for the caller to store.
  * @param a Owner
  * @param b Resource
  * @hidden
  * @internal
  */
  _createEdge(name, a, b, attributes) {
    const edge = new GraphEdge(name, a, b, attributes);
    this._edges.add(edge);
    const parent = edge.getParent();
    if (!this._parentEdges.has(parent)) this._parentEdges.set(parent, /* @__PURE__ */ new Set());
    this._parentEdges.get(parent).add(edge);
    const child = edge.getChild();
    if (!this._childEdges.has(child)) this._childEdges.set(child, /* @__PURE__ */ new Set());
    this._childEdges.get(child).add(edge);
    return edge;
  }
  /**
  * Detaches a {@link GraphEdge} from the {@link Graph}. Before calling this
  * method, ensure that the GraphEdge has first been detached from any
  * associated {@link GraphNode} attributes.
  * @hidden
  * @internal
  */
  _destroyEdge(edge) {
    this._edges.delete(edge);
    this._parentEdges.get(edge.getParent()).delete(edge);
    this._childEdges.get(edge.getChild()).delete(edge);
    return this;
  }
};
var RefList = class {
  list = [];
  constructor(refs) {
    if (refs) for (const ref of refs) this.list.push(ref);
  }
  add(ref) {
    this.list.push(ref);
  }
  remove(ref) {
    const index = this.list.indexOf(ref);
    if (index >= 0) this.list.splice(index, 1);
  }
  removeChild(child) {
    const refs = [];
    for (const ref of this.list) if (ref.getChild() === child) refs.push(ref);
    for (const ref of refs) this.remove(ref);
    return refs;
  }
  listRefsByChild(child) {
    const refs = [];
    for (const ref of this.list) if (ref.getChild() === child) refs.push(ref);
    return refs;
  }
  values() {
    return this.list;
  }
};
var RefSet = class {
  set = /* @__PURE__ */ new Set();
  map = /* @__PURE__ */ new Map();
  constructor(refs) {
    if (refs) for (const ref of refs) this.add(ref);
  }
  add(ref) {
    const child = ref.getChild();
    this.removeChild(child);
    this.set.add(ref);
    this.map.set(child, ref);
  }
  remove(ref) {
    this.set.delete(ref);
    this.map.delete(ref.getChild());
  }
  removeChild(child) {
    const ref = this.map.get(child) || null;
    if (ref) this.remove(ref);
    return ref;
  }
  getRefByChild(child) {
    return this.map.get(child) || null;
  }
  values() {
    return Array.from(this.set);
  }
};
var RefMap = class {
  map = {};
  constructor(map) {
    if (map) Object.assign(this.map, map);
  }
  set(key, child) {
    this.map[key] = child;
  }
  delete(key) {
    delete this.map[key];
  }
  get(key) {
    return this.map[key] || null;
  }
  keys() {
    return Object.keys(this.map);
  }
  values() {
    return Object.values(this.map);
  }
};
const $attributes = Symbol("attributes");
const $immutableKeys = Symbol("immutableKeys");
var GraphNode = class GraphNode2 extends EventDispatcher {
  _disposed = false;
  /**
  * Internal graph used to search and maintain references.
  * @hidden
  */
  graph;
  /**
  * Attributes (literal values and GraphNode references) associated with this instance. For each
  * GraphNode reference, the attributes stores a {@link GraphEdge}. List and Map references are
  * stored as arrays and dictionaries of edges.
  * @internal
  */
  [$attributes];
  /**
  * Attributes included with `getDefaultAttributes` are considered immutable, and cannot be
  * modifed by `.setRef()`, `.copy()`, or other GraphNode methods. Both the edges and the
  * properties will be disposed with the parent GraphNode.
  *
  * Currently, only single-edge references (getRef/setRef) are supported as immutables.
  *
  * @internal
  */
  [$immutableKeys];
  constructor(graph) {
    super();
    this.graph = graph;
    this[$immutableKeys] = /* @__PURE__ */ new Set();
    this[$attributes] = this._createAttributes();
  }
  /**
  * Returns default attributes for the graph node. Subclasses having any attributes (either
  * literal values or references to other graph nodes) must override this method. Literal
  * attributes should be given their default values, if any. References should generally be
  * initialized as empty (Ref → null, RefList → [], RefMap → {}) and then modified by setters.
  *
  * Any single-edge references (setRef) returned by this method will be considered immutable,
  * to be owned by and disposed with the parent node. Multi-edge references (addRef, removeRef,
  * setRefMap) cannot be returned as default attributes.
  */
  getDefaults() {
    return {};
  }
  /**
  * Constructs and returns an object used to store a graph nodes attributes. Compared to the
  * default Attributes interface, this has two distinctions:
  *
  * 1. Slots for GraphNode<T> objects are replaced with slots for GraphEdge<this, GraphNode<T>>
  * 2. GraphNode<T> objects provided as defaults are considered immutable
  *
  * @internal
  */
  _createAttributes() {
    const defaultAttributes = this.getDefaults();
    const attributes = {};
    for (const key in defaultAttributes) {
      const value = defaultAttributes[key];
      if (value instanceof GraphNode2) {
        const ref = this.graph._createEdge(key, this, value);
        this[$immutableKeys].add(key);
        attributes[key] = ref;
      } else attributes[key] = value;
    }
    return attributes;
  }
  /** @internal Returns true if two nodes are on the same {@link Graph}. */
  isOnGraph(other) {
    return this.graph === other.graph;
  }
  /** Returns true if the node has been permanently removed from the graph. */
  isDisposed() {
    return this._disposed;
  }
  /**
  * Removes both inbound references to and outbound references from this object. At the end
  * of the process the object holds no references, and nothing holds references to it. A
  * disposed object is not reusable.
  */
  dispose() {
    if (this._disposed) return;
    this.graph.listChildEdges(this).forEach((edge) => edge.dispose());
    this.graph.disconnectParents(this);
    this._disposed = true;
    this.dispatchEvent({ type: "dispose" });
  }
  /**
  * Removes all inbound references to this object. At the end of the process the object is
  * considered 'detached': it may hold references to child resources, but nothing holds
  * references to it. A detached object may be re-attached.
  */
  detach() {
    this.graph.disconnectParents(this);
    return this;
  }
  /**
  * Transfers this object's references from the old node to the new one. The old node is fully
  * detached from this parent at the end of the process.
  *
  * @hidden
  */
  swap(prevValue, nextValue) {
    for (const attribute in this[$attributes]) {
      const value = this[$attributes][attribute];
      if (value instanceof GraphEdge) {
        const ref = value;
        if (ref.getChild() === prevValue) this.setRef(attribute, nextValue, ref.getAttributes());
      } else if (value instanceof RefList) for (const ref of value.listRefsByChild(prevValue)) {
        const refAttributes = ref.getAttributes();
        this.removeRef(attribute, prevValue);
        this.addRef(attribute, nextValue, refAttributes);
      }
      else if (value instanceof RefSet) {
        const ref = value.getRefByChild(prevValue);
        if (ref) {
          const refAttributes = ref.getAttributes();
          this.removeRef(attribute, prevValue);
          this.addRef(attribute, nextValue, refAttributes);
        }
      } else if (value instanceof RefMap) for (const key of value.keys()) {
        const ref = value.get(key);
        if (ref.getChild() === prevValue) this.setRefMap(attribute, key, nextValue, ref.getAttributes());
      }
    }
    return this;
  }
  /**********************************************************************************************
  * Literal attributes.
  */
  /** @hidden */
  get(attribute) {
    return this[$attributes][attribute];
  }
  /** @hidden */
  set(attribute, value) {
    this[$attributes][attribute] = value;
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /**********************************************************************************************
  * Ref: 1:1 graph node references.
  */
  /** @hidden */
  getRef(attribute) {
    const ref = this[$attributes][attribute];
    return ref ? ref.getChild() : null;
  }
  /** @hidden */
  setRef(attribute, value, attributes) {
    if (this[$immutableKeys].has(attribute)) throw new Error(`Cannot overwrite immutable attribute, "${attribute}".`);
    const prevRef = this[$attributes][attribute];
    if (prevRef) prevRef.dispose();
    if (!value) return this;
    const ref = this.graph._createEdge(attribute, this, value, attributes);
    this[$attributes][attribute] = ref;
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /**********************************************************************************************
  * RefList: 1:many graph node references.
  */
  /** @hidden */
  listRefs(attribute) {
    return this.assertRefList(attribute).values().map((ref) => ref.getChild());
  }
  /** @hidden */
  addRef(attribute, value, attributes) {
    const ref = this.graph._createEdge(attribute, this, value, attributes);
    this.assertRefList(attribute).add(ref);
    return this.dispatchEvent({
      type: "change",
      attribute
    });
  }
  /** @hidden */
  removeRef(attribute, value) {
    const refs = this.assertRefList(attribute);
    if (refs instanceof RefList) for (const ref of refs.listRefsByChild(value)) ref.dispose();
    else {
      const ref = refs.getRefByChild(value);
      if (ref) ref.dispose();
    }
    return this;
  }
  /** @hidden */
  assertRefList(attribute) {
    const refs = this[$attributes][attribute];
    if (refs instanceof RefList || refs instanceof RefSet) return refs;
    throw new Error(`Expected RefList or RefSet for attribute "${attribute}"`);
  }
  /**********************************************************************************************
  * RefMap: Named 1:many (map) graph node references.
  */
  /** @hidden */
  listRefMapKeys(attribute) {
    return this.assertRefMap(attribute).keys();
  }
  /** @hidden */
  listRefMapValues(attribute) {
    return this.assertRefMap(attribute).values().map((ref) => ref.getChild());
  }
  /** @hidden */
  getRefMap(attribute, key) {
    const ref = this.assertRefMap(attribute).get(key);
    return ref ? ref.getChild() : null;
  }
  /** @hidden */
  setRefMap(attribute, key, value, metadata) {
    const refMap = this.assertRefMap(attribute);
    const prevRef = refMap.get(key);
    if (prevRef) prevRef.dispose();
    if (!value) return this;
    metadata = Object.assign(metadata || {}, { key });
    const ref = this.graph._createEdge(attribute, this, value, {
      ...metadata,
      key
    });
    refMap.set(key, ref);
    return this.dispatchEvent({
      type: "change",
      attribute,
      key
    });
  }
  /** @hidden */
  assertRefMap(attribute) {
    const map = this[$attributes][attribute];
    if (map instanceof RefMap) return map;
    throw new Error(`Expected RefMap for attribute "${attribute}"`);
  }
  /**********************************************************************************************
  * Events.
  */
  /**
  * Dispatches an event on the GraphNode, and on the associated
  * Graph. Event types on the graph are prefixed, `"node:[type]"`.
  */
  dispatchEvent(event) {
    super.dispatchEvent({
      ...event,
      target: this
    });
    this.graph.dispatchEvent({
      ...event,
      target: this,
      type: `node:${event.type}`
    });
    return this;
  }
  /**********************************************************************************************
  * Internal.
  */
  /** @hidden */
  _destroyRef(ref) {
    const attribute = ref.getName();
    if (this[$attributes][attribute] === ref) {
      this[$attributes][attribute] = null;
      if (this[$immutableKeys].has(attribute)) ref.getChild().dispose();
    } else if (this[$attributes][attribute] instanceof RefList) this[$attributes][attribute].remove(ref);
    else if (this[$attributes][attribute] instanceof RefSet) this[$attributes][attribute].remove(ref);
    else if (this[$attributes][attribute] instanceof RefMap) {
      const refMap = this[$attributes][attribute];
      for (const key of refMap.keys()) if (refMap.get(key) === ref) refMap.delete(key);
    } else return;
    this.graph._destroyEdge(ref);
    this.dispatchEvent({
      type: "change",
      attribute
    });
  }
};
const VERSION = `v${"4.3.0"}`;
const GLB_BUFFER = "@glb.bin";
var PropertyType;
(function(PropertyType2) {
  PropertyType2["ACCESSOR"] = "Accessor";
  PropertyType2["ANIMATION"] = "Animation";
  PropertyType2["ANIMATION_CHANNEL"] = "AnimationChannel";
  PropertyType2["ANIMATION_SAMPLER"] = "AnimationSampler";
  PropertyType2["BUFFER"] = "Buffer";
  PropertyType2["CAMERA"] = "Camera";
  PropertyType2["MATERIAL"] = "Material";
  PropertyType2["MESH"] = "Mesh";
  PropertyType2["PRIMITIVE"] = "Primitive";
  PropertyType2["PRIMITIVE_TARGET"] = "PrimitiveTarget";
  PropertyType2["NODE"] = "Node";
  PropertyType2["ROOT"] = "Root";
  PropertyType2["SCENE"] = "Scene";
  PropertyType2["SKIN"] = "Skin";
  PropertyType2["TEXTURE"] = "Texture";
  PropertyType2["TEXTURE_INFO"] = "TextureInfo";
})(PropertyType || (PropertyType = {}));
var VertexLayout;
(function(VertexLayout2) {
  VertexLayout2["INTERLEAVED"] = "interleaved";
  VertexLayout2["SEPARATE"] = "separate";
})(VertexLayout || (VertexLayout = {}));
var BufferViewUsage$1;
(function(BufferViewUsage2) {
  BufferViewUsage2["ARRAY_BUFFER"] = "ARRAY_BUFFER";
  BufferViewUsage2["ELEMENT_ARRAY_BUFFER"] = "ELEMENT_ARRAY_BUFFER";
  BufferViewUsage2["INVERSE_BIND_MATRICES"] = "INVERSE_BIND_MATRICES";
  BufferViewUsage2["OTHER"] = "OTHER";
  BufferViewUsage2["SPARSE"] = "SPARSE";
})(BufferViewUsage$1 || (BufferViewUsage$1 = {}));
var TextureChannel;
(function(TextureChannel2) {
  TextureChannel2[TextureChannel2["R"] = 4096] = "R";
  TextureChannel2[TextureChannel2["G"] = 256] = "G";
  TextureChannel2[TextureChannel2["B"] = 16] = "B";
  TextureChannel2[TextureChannel2["A"] = 1] = "A";
})(TextureChannel || (TextureChannel = {}));
var Format;
(function(Format2) {
  Format2["GLTF"] = "GLTF";
  Format2["GLB"] = "GLB";
})(Format || (Format = {}));
const ComponentTypeToTypedArray = {
  "5120": Int8Array,
  "5121": Uint8Array,
  "5122": Int16Array,
  "5123": Uint16Array,
  "5125": Uint32Array,
  "5126": Float32Array
};
class BufferUtils {
  /** Creates a byte array from a Data URI. */
  static createBufferFromDataURI(dataURI) {
    if (typeof Buffer === "undefined") {
      const byteString = atob(dataURI.split(",")[1]);
      const ia = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      return ia;
    } else {
      const data = dataURI.split(",")[1];
      const isBase64 = dataURI.indexOf("base64") >= 0;
      return Buffer.from(data, isBase64 ? "base64" : "utf8");
    }
  }
  /** Encodes text to a byte array. */
  static encodeText(text) {
    return new TextEncoder().encode(text);
  }
  /** Decodes a byte array to text. */
  static decodeText(array) {
    return new TextDecoder().decode(array);
  }
  /**
   * Concatenates N byte arrays.
   */
  static concat(arrays) {
    let totalByteLength = 0;
    for (const array of arrays) {
      totalByteLength += array.byteLength;
    }
    const result = new Uint8Array(totalByteLength);
    let byteOffset = 0;
    for (const array of arrays) {
      result.set(array, byteOffset);
      byteOffset += array.byteLength;
    }
    return result;
  }
  /**
   * Pads a Uint8Array to the next 4-byte boundary.
   *
   * Reference: [glTF → Data Alignment](https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment)
   */
  static pad(srcArray, paddingByte = 0) {
    const paddedLength = this.padNumber(srcArray.byteLength);
    if (paddedLength === srcArray.byteLength) return srcArray;
    const dstArray = new Uint8Array(paddedLength);
    dstArray.set(srcArray);
    if (paddingByte !== 0) {
      for (let i = srcArray.byteLength; i < paddedLength; i++) {
        dstArray[i] = paddingByte;
      }
    }
    return dstArray;
  }
  /** Pads a number to 4-byte boundaries. */
  static padNumber(v) {
    return Math.ceil(v / 4) * 4;
  }
  /** Returns true if given byte array instances are equal. */
  static equals(a, b) {
    if (a === b) return true;
    if (a.byteLength !== b.byteLength) return false;
    let i = a.byteLength;
    while (i--) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  /**
   * Returns a Uint8Array view of a typed array, with the same underlying ArrayBuffer.
   *
   * A shorthand for:
   *
   * ```js
   * const buffer = new Uint8Array(
   * 	array.buffer,
   * 	array.byteOffset + byteOffset,
   * 	Math.min(array.byteLength, byteLength)
   * );
   * ```
   *
   */
  static toView(a, byteOffset = 0, byteLength = Infinity) {
    return new Uint8Array(a.buffer, a.byteOffset + byteOffset, Math.min(a.byteLength, byteLength));
  }
  static assertView(view) {
    if (view && !ArrayBuffer.isView(view)) {
      throw new Error(`Method requires Uint8Array parameter; received "${typeof view}".`);
    }
    return view;
  }
}
class JPEGImageUtils {
  match(array) {
    return array.length >= 3 && array[0] === 255 && array[1] === 216 && array[2] === 255;
  }
  getSize(array) {
    let view = new DataView(array.buffer, array.byteOffset + 4);
    let i, next;
    while (view.byteLength) {
      i = view.getUint16(0, false);
      validateJPEGBuffer(view, i);
      next = view.getUint8(i + 1);
      if (next === 192 || next === 193 || next === 194) {
        return [view.getUint16(i + 7, false), view.getUint16(i + 5, false)];
      }
      view = new DataView(array.buffer, view.byteOffset + i + 2);
    }
    throw new TypeError("Invalid JPG, no size found");
  }
  getChannels(_buffer) {
    return 3;
  }
}
class PNGImageUtils {
  match(array) {
    return array.length >= 8 && array[0] === 137 && array[1] === 80 && array[2] === 78 && array[3] === 71 && array[4] === 13 && array[5] === 10 && array[6] === 26 && array[7] === 10;
  }
  getSize(array) {
    const view = new DataView(array.buffer, array.byteOffset);
    const magic = BufferUtils.decodeText(array.slice(12, 16));
    if (magic === PNGImageUtils.PNG_FRIED_CHUNK_NAME) {
      return [view.getUint32(32, false), view.getUint32(36, false)];
    }
    return [view.getUint32(16, false), view.getUint32(20, false)];
  }
  getChannels(_buffer) {
    return 4;
  }
}
PNGImageUtils.PNG_FRIED_CHUNK_NAME = "CgBI";
class ImageUtils {
  /** Registers support for a new image format; useful for certain extensions. */
  static registerFormat(mimeType, impl) {
    this.impls[mimeType] = impl;
  }
  /**
   * Returns detected MIME type of the given image buffer. Note that for image
   * formats with support provided by extensions, the extension must be
   * registered with an I/O class before it can be detected by ImageUtils.
   */
  static getMimeType(buffer) {
    for (const mimeType in this.impls) {
      if (this.impls[mimeType].match(buffer)) {
        return mimeType;
      }
    }
    return null;
  }
  /** Returns the dimensions of the image. */
  static getSize(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    return this.impls[mimeType].getSize(buffer);
  }
  /**
   * Returns a conservative estimate of the number of channels in the image. For some image
   * formats, the method may return 4 indicating the possibility of an alpha channel, without
   * the ability to guarantee that an alpha channel is present.
   */
  static getChannels(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    return this.impls[mimeType].getChannels(buffer);
  }
  /** Returns a conservative estimate of the GPU memory required by this image. */
  static getVRAMByteLength(buffer, mimeType) {
    if (!this.impls[mimeType]) return null;
    if (this.impls[mimeType].getVRAMByteLength) {
      return this.impls[mimeType].getVRAMByteLength(buffer);
    }
    let uncompressedBytes = 0;
    const channels = 4;
    const resolution = this.getSize(buffer, mimeType);
    if (!resolution) return null;
    while (resolution[0] > 1 || resolution[1] > 1) {
      uncompressedBytes += resolution[0] * resolution[1] * channels;
      resolution[0] = Math.max(Math.floor(resolution[0] / 2), 1);
      resolution[1] = Math.max(Math.floor(resolution[1] / 2), 1);
    }
    uncompressedBytes += 1 * 1 * channels;
    return uncompressedBytes;
  }
  /** Returns the preferred file extension for the given MIME type. */
  static mimeTypeToExtension(mimeType) {
    if (mimeType === "image/jpeg") return "jpg";
    return mimeType.split("/").pop();
  }
  /** Returns the MIME type for the given file extension. */
  static extensionToMimeType(extension) {
    if (extension === "jpg") return "image/jpeg";
    if (!extension) return "";
    return `image/${extension}`;
  }
}
ImageUtils.impls = {
  "image/jpeg": new JPEGImageUtils(),
  "image/png": new PNGImageUtils()
};
function validateJPEGBuffer(view, i) {
  if (i > view.byteLength) {
    throw new TypeError("Corrupt JPG, exceeded buffer limits");
  }
  if (view.getUint8(i) !== 255) {
    throw new TypeError("Invalid JPG, marker table corrupted");
  }
  return view;
}
class FileUtils {
  /**
   * Extracts the basename from a file path, e.g. "folder/model.glb" -> "model".
   * See: {@link HTTPUtils.basename}
   */
  static basename(uri) {
    const fileName = uri.split(/[\\/]/).pop();
    return fileName.substring(0, fileName.lastIndexOf("."));
  }
  /**
   * Extracts the extension from a file path, e.g. "folder/model.glb" -> "glb".
   * See: {@link HTTPUtils.extension}
   */
  static extension(uri) {
    if (uri.startsWith("data:image/")) {
      const mimeType = uri.match(/data:(image\/\w+)/)[1];
      return ImageUtils.mimeTypeToExtension(mimeType);
    } else if (uri.startsWith("data:model/gltf+json")) {
      return "gltf";
    } else if (uri.startsWith("data:model/gltf-binary")) {
      return "glb";
    } else if (uri.startsWith("data:application/")) {
      return "bin";
    }
    return uri.split(/[\\/]/).pop().split(/[.]/).pop();
  }
}
var ARRAY_TYPE = typeof Float32Array !== "undefined" ? Float32Array : Array;
function create() {
  var out = new ARRAY_TYPE(3);
  if (ARRAY_TYPE != Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}
function length(a) {
  var x = a[0];
  var y = a[1];
  var z = a[2];
  return Math.sqrt(x * x + y * y + z * z);
}
(function() {
  var vec = create();
  return function(a, stride, offset, count, fn, arg) {
    var i, l;
    if (!stride) {
      stride = 3;
    }
    if (!offset) {
      offset = 0;
    }
    if (count) {
      l = Math.min(count * stride + offset, a.length);
    } else {
      l = a.length;
    }
    for (i = offset; i < l; i += stride) {
      vec[0] = a[i];
      vec[1] = a[i + 1];
      vec[2] = a[i + 2];
      fn(vec, vec, arg);
      a[i] = vec[0];
      a[i + 1] = vec[1];
      a[i + 2] = vec[2];
    }
    return a;
  };
})();
const NULL_DOMAIN = "https://null.example";
class HTTPUtils {
  static dirname(path2) {
    const index = path2.lastIndexOf("/");
    if (index === -1) return "./";
    return path2.substring(0, index + 1);
  }
  /**
   * Extracts the basename from a URL, e.g. "folder/model.glb" -> "model".
   * See: {@link FileUtils.basename}
   */
  static basename(uri) {
    return FileUtils.basename(new URL(uri, NULL_DOMAIN).pathname);
  }
  /**
   * Extracts the extension from a URL, e.g. "folder/model.glb" -> "glb".
   * See: {@link FileUtils.extension}
   */
  static extension(uri) {
    return FileUtils.extension(new URL(uri, NULL_DOMAIN).pathname);
  }
  static resolve(base, path2) {
    if (!this.isRelativePath(path2)) return path2;
    const stack = base.split("/");
    const parts = path2.split("/");
    stack.pop();
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === ".") continue;
      if (parts[i] === "..") {
        stack.pop();
      } else {
        stack.push(parts[i]);
      }
    }
    return stack.join("/");
  }
  /**
   * Returns true for URLs containing a protocol, and false for both
   * absolute and relative paths.
   */
  static isAbsoluteURL(path2) {
    return this.PROTOCOL_REGEXP.test(path2);
  }
  /**
   * Returns true for paths that are declared relative to some unknown base
   * path. For example, "foo/bar/" is relative both "/foo/bar/" is not.
   */
  static isRelativePath(path2) {
    return !/^(?:[a-zA-Z]+:)?\//.test(path2);
  }
}
HTTPUtils.DEFAULT_INIT = {};
HTTPUtils.PROTOCOL_REGEXP = /^[a-zA-Z]+:\/\//;
function isObject(o) {
  return Object.prototype.toString.call(o) === "[object Object]";
}
function isPlainObject(o) {
  if (isObject(o) === false) return false;
  const ctor = o.constructor;
  if (ctor === void 0) return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false) return false;
  if (Object.hasOwn(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
var _Logger;
var Verbosity;
(function(Verbosity2) {
  Verbosity2[Verbosity2["SILENT"] = 4] = "SILENT";
  Verbosity2[Verbosity2["ERROR"] = 3] = "ERROR";
  Verbosity2[Verbosity2["WARN"] = 2] = "WARN";
  Verbosity2[Verbosity2["INFO"] = 1] = "INFO";
  Verbosity2[Verbosity2["DEBUG"] = 0] = "DEBUG";
})(Verbosity || (Verbosity = {}));
class Logger {
  /** Constructs a new Logger instance. */
  constructor(verbosity) {
    this.verbosity = void 0;
    this.verbosity = verbosity;
  }
  /** Logs an event at level {@link Logger.Verbosity.DEBUG}. */
  debug(text) {
    if (this.verbosity <= Logger.Verbosity.DEBUG) {
      console.debug(text);
    }
  }
  /** Logs an event at level {@link Logger.Verbosity.INFO}. */
  info(text) {
    if (this.verbosity <= Logger.Verbosity.INFO) {
      console.info(text);
    }
  }
  /** Logs an event at level {@link Logger.Verbosity.WARN}. */
  warn(text) {
    if (this.verbosity <= Logger.Verbosity.WARN) {
      console.warn(text);
    }
  }
  /** Logs an event at level {@link Logger.Verbosity.ERROR}. */
  error(text) {
    if (this.verbosity <= Logger.Verbosity.ERROR) {
      console.error(text);
    }
  }
}
_Logger = Logger;
Logger.Verbosity = Verbosity;
Logger.DEFAULT_INSTANCE = new _Logger(_Logger.Verbosity.INFO);
function determinant(a) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0 = a00 * a11 - a01 * a10;
  var b1 = a00 * a12 - a02 * a10;
  var b2 = a01 * a12 - a02 * a11;
  var b3 = a20 * a31 - a21 * a30;
  var b4 = a20 * a32 - a22 * a30;
  var b5 = a21 * a32 - a22 * a31;
  var b6 = a00 * b5 - a01 * b4 + a02 * b3;
  var b7 = a10 * b5 - a11 * b4 + a12 * b3;
  var b8 = a20 * b2 - a21 * b1 + a22 * b0;
  var b9 = a30 * b2 - a31 * b1 + a32 * b0;
  return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9;
}
function multiply(out, a, b) {
  var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}
function getScaling(out, mat) {
  var m11 = mat[0];
  var m12 = mat[1];
  var m13 = mat[2];
  var m21 = mat[4];
  var m22 = mat[5];
  var m23 = mat[6];
  var m31 = mat[8];
  var m32 = mat[9];
  var m33 = mat[10];
  out[0] = Math.sqrt(m11 * m11 + m12 * m12 + m13 * m13);
  out[1] = Math.sqrt(m21 * m21 + m22 * m22 + m23 * m23);
  out[2] = Math.sqrt(m31 * m31 + m32 * m32 + m33 * m33);
  return out;
}
function getRotation(out, mat) {
  var scaling = new ARRAY_TYPE(3);
  getScaling(scaling, mat);
  var is1 = 1 / scaling[0];
  var is2 = 1 / scaling[1];
  var is3 = 1 / scaling[2];
  var sm11 = mat[0] * is1;
  var sm12 = mat[1] * is2;
  var sm13 = mat[2] * is3;
  var sm21 = mat[4] * is1;
  var sm22 = mat[5] * is2;
  var sm23 = mat[6] * is3;
  var sm31 = mat[8] * is1;
  var sm32 = mat[9] * is2;
  var sm33 = mat[10] * is3;
  var trace = sm11 + sm22 + sm33;
  var S = 0;
  if (trace > 0) {
    S = Math.sqrt(trace + 1) * 2;
    out[3] = 0.25 * S;
    out[0] = (sm23 - sm32) / S;
    out[1] = (sm31 - sm13) / S;
    out[2] = (sm12 - sm21) / S;
  } else if (sm11 > sm22 && sm11 > sm33) {
    S = Math.sqrt(1 + sm11 - sm22 - sm33) * 2;
    out[3] = (sm23 - sm32) / S;
    out[0] = 0.25 * S;
    out[1] = (sm12 + sm21) / S;
    out[2] = (sm31 + sm13) / S;
  } else if (sm22 > sm33) {
    S = Math.sqrt(1 + sm22 - sm11 - sm33) * 2;
    out[3] = (sm31 - sm13) / S;
    out[0] = (sm12 + sm21) / S;
    out[1] = 0.25 * S;
    out[2] = (sm23 + sm32) / S;
  } else {
    S = Math.sqrt(1 + sm33 - sm11 - sm22) * 2;
    out[3] = (sm12 - sm21) / S;
    out[0] = (sm31 + sm13) / S;
    out[1] = (sm23 + sm32) / S;
    out[2] = 0.25 * S;
  }
  return out;
}
class MathUtils {
  static identity(v) {
    return v;
  }
  static eq(a, b, tolerance = 1e-5) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > tolerance) return false;
    }
    return true;
  }
  static clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }
  // TODO(perf): Compare performance if we replace the switch with individual functions.
  static decodeNormalizedInt(i, componentType) {
    switch (componentType) {
      case 5126:
        return i;
      case 5123:
        return i / 65535;
      case 5121:
        return i / 255;
      case 5122:
        return Math.max(i / 32767, -1);
      case 5120:
        return Math.max(i / 127, -1);
      default:
        throw new Error("Invalid component type.");
    }
  }
  // TODO(perf): Compare performance if we replace the switch with individual functions.
  static encodeNormalizedInt(f, componentType) {
    switch (componentType) {
      case 5126:
        return f;
      case 5123:
        return Math.round(MathUtils.clamp(f, 0, 1) * 65535);
      case 5121:
        return Math.round(MathUtils.clamp(f, 0, 1) * 255);
      case 5122:
        return Math.round(MathUtils.clamp(f, -1, 1) * 32767);
      case 5120:
        return Math.round(MathUtils.clamp(f, -1, 1) * 127);
      default:
        throw new Error("Invalid component type.");
    }
  }
  /**
   * Decompose a mat4 to TRS properties.
   *
   * Equivalent to the Matrix4 decompose() method in three.js, and intentionally not using the
   * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
   *
   * @param srcMat Matrix element, to be decomposed to TRS properties.
   * @param dstTranslation Translation element, to be overwritten.
   * @param dstRotation Rotation element, to be overwritten.
   * @param dstScale Scale element, to be overwritten.
   */
  static decompose(srcMat, dstTranslation, dstRotation, dstScale) {
    let sx = length([srcMat[0], srcMat[1], srcMat[2]]);
    const sy = length([srcMat[4], srcMat[5], srcMat[6]]);
    const sz = length([srcMat[8], srcMat[9], srcMat[10]]);
    const det = determinant(srcMat);
    if (det < 0) sx = -sx;
    dstTranslation[0] = srcMat[12];
    dstTranslation[1] = srcMat[13];
    dstTranslation[2] = srcMat[14];
    const _m1 = srcMat.slice();
    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;
    _m1[0] *= invSX;
    _m1[1] *= invSX;
    _m1[2] *= invSX;
    _m1[4] *= invSY;
    _m1[5] *= invSY;
    _m1[6] *= invSY;
    _m1[8] *= invSZ;
    _m1[9] *= invSZ;
    _m1[10] *= invSZ;
    getRotation(dstRotation, _m1);
    dstScale[0] = sx;
    dstScale[1] = sy;
    dstScale[2] = sz;
  }
  /**
   * Compose TRS properties to a mat4.
   *
   * Equivalent to the Matrix4 compose() method in three.js, and intentionally not using the
   * gl-matrix version. See: https://github.com/toji/gl-matrix/issues/408
   *
   * @param srcTranslation Translation element of matrix.
   * @param srcRotation Rotation element of matrix.
   * @param srcScale Scale element of matrix.
   * @param dstMat Matrix element, to be modified and returned.
   * @returns dstMat, overwritten to mat4 equivalent of given TRS properties.
   */
  static compose(srcTranslation, srcRotation, srcScale, dstMat) {
    const te = dstMat;
    const x = srcRotation[0], y = srcRotation[1], z = srcRotation[2], w = srcRotation[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = srcScale[0], sy = srcScale[1], sz = srcScale[2];
    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = srcTranslation[0];
    te[13] = srcTranslation[1];
    te[14] = srcTranslation[2];
    te[15] = 1;
    return te;
  }
}
function equalsRef(refA, refB) {
  if (!!refA !== !!refB) return false;
  const a = refA.getChild();
  const b = refB.getChild();
  return a === b || a.equals(b);
}
function equalsRefSet(refSetA, refSetB) {
  if (!!refSetA !== !!refSetB) return false;
  const refValuesA = refSetA.values();
  const refValuesB = refSetB.values();
  if (refValuesA.length !== refValuesB.length) return false;
  for (let i = 0; i < refValuesA.length; i++) {
    const a = refValuesA[i];
    const b = refValuesB[i];
    if (a.getChild() === b.getChild()) continue;
    if (!a.getChild().equals(b.getChild())) return false;
  }
  return true;
}
function equalsRefMap(refMapA, refMapB) {
  if (!!refMapA !== !!refMapB) return false;
  const keysA = refMapA.keys();
  const keysB = refMapB.keys();
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const refA = refMapA.get(key);
    const refB = refMapB.get(key);
    if (!!refA !== !!refB) return false;
    const a = refA.getChild();
    const b = refB.getChild();
    if (a === b) continue;
    if (!a.equals(b)) return false;
  }
  return true;
}
function equalsArray(a, b) {
  if (a === b) return true;
  if (!!a !== !!b || !a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function equalsObject(_a, _b) {
  if (_a === _b) return true;
  if (!!_a !== !!_b) return false;
  if (!isPlainObject(_a) || !isPlainObject(_b)) {
    return _a === _b;
  }
  const a = _a;
  const b = _b;
  let numKeysA = 0;
  let numKeysB = 0;
  let key;
  for (key in a) numKeysA++;
  for (key in b) numKeysB++;
  if (numKeysA !== numKeysB) return false;
  for (key in a) {
    const valueA = a[key];
    const valueB = b[key];
    if (isArray(valueA) && isArray(valueB)) {
      if (!equalsArray(valueA, valueB)) return false;
    } else if (isPlainObject(valueA) && isPlainObject(valueB)) {
      if (!equalsObject(valueA, valueB)) return false;
    } else {
      if (valueA !== valueB) return false;
    }
  }
  return true;
}
function isArray(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}
const ALPHABET = "23456789abdegjkmnpqrvwxyzABDEGJKMNPQRVWXYZ";
const UNIQUE_RETRIES = 999;
const ID_LENGTH = 6;
const previousIDs = /* @__PURE__ */ new Set();
const generateOne = function generateOne2() {
  let rtn = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    rtn += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return rtn;
};
const uuid = function uuid2() {
  for (let retries = 0; retries < UNIQUE_RETRIES; retries++) {
    const id = generateOne();
    if (!previousIDs.has(id)) {
      previousIDs.add(id);
      return id;
    }
  }
  return "";
};
const COPY_IDENTITY = (t) => t;
const EMPTY_SET = /* @__PURE__ */ new Set();
class Property extends GraphNode {
  /** @hidden */
  constructor(graph, name = "") {
    super(graph);
    this[$attributes]["name"] = name;
    this.init();
    this.dispatchEvent({
      type: "create"
    });
  }
  /**
   * Returns the Graph associated with this Property. For internal use.
   * @hidden
   * @experimental
   */
  getGraph() {
    return this.graph;
  }
  /**
   * Returns default attributes for the property. Empty lists and maps should be initialized
   * to empty arrays and objects. Always invoke `super.getDefaults()` and extend the result.
   */
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      name: "",
      extras: {}
    });
  }
  /** @hidden */
  set(attribute, value) {
    if (Array.isArray(value)) value = value.slice();
    return super.set(attribute, value);
  }
  /**********************************************************************************************
   * Name.
   */
  /**
   * Returns the name of this property. While names are not required to be unique, this is
   * encouraged, and non-unique names will be overwritten in some tools. For custom data about
   * a property, prefer to use Extras.
   */
  getName() {
    return this.get("name");
  }
  /**
   * Sets the name of this property. While names are not required to be unique, this is
   * encouraged, and non-unique names will be overwritten in some tools. For custom data about
   * a property, prefer to use Extras.
   */
  setName(name) {
    return this.set("name", name);
  }
  /**********************************************************************************************
   * Extras.
   */
  /**
   * Returns a reference to the Extras object, containing application-specific data for this
   * Property. Extras should be an Object, not a primitive value, for best portability.
   */
  getExtras() {
    return this.get("extras");
  }
  /**
   * Updates the Extras object, containing application-specific data for this Property. Extras
   * should be an Object, not a primitive value, for best portability.
   */
  setExtras(extras) {
    return this.set("extras", extras);
  }
  /**********************************************************************************************
   * Graph state.
   */
  /**
   * Makes a copy of this property, with the same resources (by reference) as the original.
   */
  clone() {
    const PropertyClass = this.constructor;
    return new PropertyClass(this.graph).copy(this, COPY_IDENTITY);
  }
  /**
   * Copies all data from another property to this one. Child properties are copied by reference,
   * unless a 'resolve' function is given to override that.
   * @param other Property to copy references from.
   * @param resolve Function to resolve each Property being transferred. Default is identity.
   */
  copy(other, resolve = COPY_IDENTITY) {
    for (const key in this[$attributes]) {
      const value = this[$attributes][key];
      if (value instanceof GraphEdge) {
        if (!this[$immutableKeys].has(key)) {
          value.dispose();
        }
      } else if (value instanceof RefList || value instanceof RefSet) {
        for (const ref of value.values()) {
          ref.dispose();
        }
      } else if (value instanceof RefMap) {
        for (const ref of value.values()) {
          ref.dispose();
        }
      }
    }
    for (const key in other[$attributes]) {
      const thisValue = this[$attributes][key];
      const otherValue = other[$attributes][key];
      if (otherValue instanceof GraphEdge) {
        if (this[$immutableKeys].has(key)) {
          const ref = thisValue;
          ref.getChild().copy(resolve(otherValue.getChild()), resolve);
        } else {
          this.setRef(key, resolve(otherValue.getChild()), otherValue.getAttributes());
        }
      } else if (otherValue instanceof RefSet || otherValue instanceof RefList) {
        for (const ref of otherValue.values()) {
          this.addRef(key, resolve(ref.getChild()), ref.getAttributes());
        }
      } else if (otherValue instanceof RefMap) {
        for (const subkey of otherValue.keys()) {
          const ref = otherValue.get(subkey);
          this.setRefMap(key, subkey, resolve(ref.getChild()), ref.getAttributes());
        }
      } else if (isPlainObject(otherValue)) {
        this[$attributes][key] = JSON.parse(JSON.stringify(otherValue));
      } else if (Array.isArray(otherValue) || otherValue instanceof ArrayBuffer || ArrayBuffer.isView(otherValue)) {
        this[$attributes][key] = otherValue.slice();
      } else {
        this[$attributes][key] = otherValue;
      }
    }
    return this;
  }
  /**
   * Returns true if two properties are deeply equivalent, recursively comparing the attributes
   * of the properties. Optionally, a 'skip' set may be included, specifying attributes whose
   * values should not be considered in the comparison.
   *
   * Example: Two {@link Primitive Primitives} are equivalent if they have accessors and
   * materials with equivalent content — but not necessarily the same specific accessors
   * and materials.
   */
  equals(other, skip = EMPTY_SET) {
    if (this === other) return true;
    if (this.propertyType !== other.propertyType) return false;
    for (const key in this[$attributes]) {
      if (skip.has(key)) continue;
      const a = this[$attributes][key];
      const b = other[$attributes][key];
      if (a instanceof GraphEdge || b instanceof GraphEdge) {
        if (!equalsRef(a, b)) {
          return false;
        }
      } else if (a instanceof RefSet || b instanceof RefSet || a instanceof RefList || b instanceof RefList) {
        if (!equalsRefSet(a, b)) {
          return false;
        }
      } else if (a instanceof RefMap || b instanceof RefMap) {
        if (!equalsRefMap(a, b)) {
          return false;
        }
      } else if (isPlainObject(a) || isPlainObject(b)) {
        if (!equalsObject(a, b)) return false;
      } else if (isArray(a) || isArray(b)) {
        if (!equalsArray(a, b)) return false;
      } else {
        if (a !== b) return false;
      }
    }
    return true;
  }
  detach() {
    this.graph.disconnectParents(this, (n) => n.propertyType !== "Root");
    return this;
  }
  /**
   * Returns a list of all properties that hold a reference to this property. For example, a
   * material may hold references to various textures, but a texture does not hold references
   * to the materials that use it.
   *
   * It is often necessary to filter the results for a particular type: some resources, like
   * {@link Accessor}s, may be referenced by different types of properties. Most properties
   * include the {@link Root} as a parent, which is usually not of interest.
   *
   * Usage:
   *
   * ```ts
   * const materials = texture
   * 	.listParents()
   * 	.filter((p) => p instanceof Material)
   * ```
   */
  listParents() {
    return this.graph.listParents(this);
  }
}
class ExtensibleProperty extends Property {
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      extensions: new RefMap()
    });
  }
  /** Returns an {@link ExtensionProperty} attached to this Property, if any. */
  getExtension(name) {
    return this.getRefMap("extensions", name);
  }
  /**
   * Attaches the given {@link ExtensionProperty} to this Property. For a given extension, only
   * one ExtensionProperty may be attached to any one Property at a time.
   */
  setExtension(name, extensionProperty) {
    if (extensionProperty) extensionProperty._validateParent(this);
    return this.setRefMap("extensions", name, extensionProperty);
  }
  /** Lists all {@link ExtensionProperty} instances attached to this Property. */
  listExtensions() {
    return this.listRefMapValues("extensions");
  }
}
class Accessor extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.ACCESSOR;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      array: null,
      type: Accessor.Type.SCALAR,
      componentType: Accessor.ComponentType.FLOAT,
      normalized: false,
      sparse: false,
      buffer: null
    });
  }
  /**********************************************************************************************
   * Static.
   */
  /** Returns size of a given element type, in components. */
  static getElementSize(type) {
    switch (type) {
      case Accessor.Type.SCALAR:
        return 1;
      case Accessor.Type.VEC2:
        return 2;
      case Accessor.Type.VEC3:
        return 3;
      case Accessor.Type.VEC4:
        return 4;
      case Accessor.Type.MAT2:
        return 4;
      case Accessor.Type.MAT3:
        return 9;
      case Accessor.Type.MAT4:
        return 16;
      default:
        throw new Error("Unexpected type: " + type);
    }
  }
  /** Returns size of a given component type, in bytes. */
  static getComponentSize(componentType) {
    switch (componentType) {
      case Accessor.ComponentType.BYTE:
        return 1;
      case Accessor.ComponentType.UNSIGNED_BYTE:
        return 1;
      case Accessor.ComponentType.SHORT:
        return 2;
      case Accessor.ComponentType.UNSIGNED_SHORT:
        return 2;
      case Accessor.ComponentType.UNSIGNED_INT:
        return 4;
      case Accessor.ComponentType.FLOAT:
        return 4;
      default:
        throw new Error("Unexpected component type: " + componentType);
    }
  }
  /**********************************************************************************************
   * Min/max bounds.
   */
  /**
   * Minimum value of each component in this attribute. Unlike in a final glTF file, values
   * returned by this method will reflect the minimum accounting for {@link .normalized}
   * state.
   */
  getMinNormalized(target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    this.getMin(target);
    if (normalized) {
      for (let j = 0; j < elementSize; j++) {
        target[j] = MathUtils.decodeNormalizedInt(target[j], componentType);
      }
    }
    return target;
  }
  /**
   * Minimum value of each component in this attribute. Values returned by this method do not
   * reflect normalization: use {@link .getMinNormalized} in that case.
   */
  getMin(target) {
    const array = this.getArray();
    const count = this.getCount();
    const elementSize = this.getElementSize();
    for (let j = 0; j < elementSize; j++) target[j] = Infinity;
    for (let i = 0; i < count * elementSize; i += elementSize) {
      for (let j = 0; j < elementSize; j++) {
        const value = array[i + j];
        if (Number.isFinite(value)) {
          target[j] = Math.min(target[j], value);
        }
      }
    }
    return target;
  }
  /**
   * Maximum value of each component in this attribute. Unlike in a final glTF file, values
   * returned by this method will reflect the minimum accounting for {@link .normalized}
   * state.
   */
  getMaxNormalized(target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    this.getMax(target);
    if (normalized) {
      for (let j = 0; j < elementSize; j++) {
        target[j] = MathUtils.decodeNormalizedInt(target[j], componentType);
      }
    }
    return target;
  }
  /**
   * Maximum value of each component in this attribute. Values returned by this method do not
   * reflect normalization: use {@link .getMinNormalized} in that case.
   */
  getMax(target) {
    const array = this.get("array");
    const count = this.getCount();
    const elementSize = this.getElementSize();
    for (let j = 0; j < elementSize; j++) target[j] = -Infinity;
    for (let i = 0; i < count * elementSize; i += elementSize) {
      for (let j = 0; j < elementSize; j++) {
        const value = array[i + j];
        if (Number.isFinite(value)) {
          target[j] = Math.max(target[j], value);
        }
      }
    }
    return target;
  }
  /**********************************************************************************************
   * Layout.
   */
  /**
   * Number of elements in the accessor. An array of length 30, containing 10 `VEC3` elements,
   * will have a count of 10.
   */
  getCount() {
    const array = this.get("array");
    return array ? array.length / this.getElementSize() : 0;
  }
  /** Type of element stored in the accessor. `VEC2`, `VEC3`, etc. */
  getType() {
    return this.get("type");
  }
  /**
   * Sets type of element stored in the accessor. `VEC2`, `VEC3`, etc. Array length must be a
   * multiple of the component size (`VEC2` = 2, `VEC3` = 3, ...) for the selected type.
   */
  setType(type) {
    return this.set("type", type);
  }
  /**
   * Number of components in each element of the accessor. For example, the element size of a
   * `VEC2` accessor is 2. This value is determined automatically based on array length and
   * accessor type, specified with {@link Accessor.setType setType()}.
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: Static vs. non-static.
  getElementSize() {
    return Accessor.getElementSize(this.get("type"));
  }
  /**
   * Size of each component (a value in the raw array), in bytes. For example, the
   * `componentSize` of data backed by a `float32` array is 4 bytes.
   */
  getComponentSize() {
    return this.get("array").BYTES_PER_ELEMENT;
  }
  /**
   * Component type (float32, uint16, etc.). This value is determined automatically, and can only
   * be modified by replacing the underlying array.
   */
  getComponentType() {
    return this.get("componentType");
  }
  /**********************************************************************************************
   * Normalization.
   */
  /**
   * Specifies whether integer data values should be normalized (true) to [0, 1] (for unsigned
   * types) or [-1, 1] (for signed types), or converted directly (false) when they are accessed.
   * This property is defined only for accessors that contain vertex attributes or animation
   * output data.
   */
  getNormalized() {
    return this.get("normalized");
  }
  /**
   * Specifies whether integer data values should be normalized (true) to [0, 1] (for unsigned
   * types) or [-1, 1] (for signed types), or converted directly (false) when they are accessed.
   * This property is defined only for accessors that contain vertex attributes or animation
   * output data.
   */
  setNormalized(normalized) {
    return this.set("normalized", normalized);
  }
  /**********************************************************************************************
   * Data access.
   */
  /**
   * Returns the scalar element value at the given index. For
   * {@link Accessor.getNormalized normalized} integer accessors, values are
   * decoded and returned in floating-point form.
   */
  getScalar(index) {
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    if (this.getNormalized()) {
      return MathUtils.decodeNormalizedInt(array[index * elementSize], componentType);
    }
    return array[index * elementSize];
  }
  /**
   * Assigns the scalar element value at the given index. For
   * {@link Accessor.getNormalized normalized} integer accessors, "value" should be
   * given in floating-point form — it will be integer-encoded before writing
   * to the underlying array.
   */
  setScalar(index, x) {
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    if (this.getNormalized()) {
      array[index * elementSize] = MathUtils.encodeNormalizedInt(x, componentType);
    } else {
      array[index * elementSize] = x;
    }
    return this;
  }
  /**
   * Returns the vector or matrix element value at the given index. For
   * {@link Accessor.getNormalized normalized} integer accessors, values are
   * decoded and returned in floating-point form.
   *
   * Example:
   *
   * ```javascript
   * import { add } from 'gl-matrix/add';
   *
   * const element = [];
   * const offset = [1, 1, 1];
   *
   * for (let i = 0; i < accessor.getCount(); i++) {
   * 	accessor.getElement(i, element);
   * 	add(element, element, offset);
   * 	accessor.setElement(i, element);
   * }
   * ```
   */
  getElement(index, target) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    for (let i = 0; i < elementSize; i++) {
      if (normalized) {
        target[i] = MathUtils.decodeNormalizedInt(array[index * elementSize + i], componentType);
      } else {
        target[i] = array[index * elementSize + i];
      }
    }
    return target;
  }
  /**
   * Assigns the vector or matrix element value at the given index. For
   * {@link Accessor.getNormalized normalized} integer accessors, "value" should be
   * given in floating-point form — it will be integer-encoded before writing
   * to the underlying array.
   *
   * Example:
   *
   * ```javascript
   * import { add } from 'gl-matrix/add';
   *
   * const element = [];
   * const offset = [1, 1, 1];
   *
   * for (let i = 0; i < accessor.getCount(); i++) {
   * 	accessor.getElement(i, element);
   * 	add(element, element, offset);
   * 	accessor.setElement(i, element);
   * }
   * ```
   */
  setElement(index, value) {
    const normalized = this.getNormalized();
    const elementSize = this.getElementSize();
    const componentType = this.getComponentType();
    const array = this.getArray();
    for (let i = 0; i < elementSize; i++) {
      if (normalized) {
        array[index * elementSize + i] = MathUtils.encodeNormalizedInt(value[i], componentType);
      } else {
        array[index * elementSize + i] = value[i];
      }
    }
    return this;
  }
  /**********************************************************************************************
   * Raw data storage.
   */
  /**
   * Specifies whether the accessor should be stored sparsely. When written to a glTF file, sparse
   * accessors store only values that differ from base values. When loaded in glTF Transform (or most
   * runtimes) a sparse accessor can be treated like any other accessor. Currently, glTF Transform always
   * uses zeroes for the base values when writing files.
   * @experimental
   */
  getSparse() {
    return this.get("sparse");
  }
  /**
   * Specifies whether the accessor should be stored sparsely. When written to a glTF file, sparse
   * accessors store only values that differ from base values. When loaded in glTF Transform (or most
   * runtimes) a sparse accessor can be treated like any other accessor. Currently, glTF Transform always
   * uses zeroes for the base values when writing files.
   * @experimental
   */
  setSparse(sparse) {
    return this.set("sparse", sparse);
  }
  /** Returns the {@link Buffer} into which this accessor will be organized. */
  getBuffer() {
    return this.getRef("buffer");
  }
  /** Assigns the {@link Buffer} into which this accessor will be organized. */
  setBuffer(buffer) {
    return this.setRef("buffer", buffer);
  }
  /** Returns the raw typed array underlying this accessor. */
  getArray() {
    return this.get("array");
  }
  /** Assigns the raw typed array underlying this accessor. */
  setArray(array) {
    this.set("componentType", array ? arrayToComponentType(array) : Accessor.ComponentType.FLOAT);
    this.set("array", array);
    return this;
  }
  /** Returns the total bytelength of this accessor, exclusive of padding. */
  getByteLength() {
    const array = this.get("array");
    return array ? array.byteLength : 0;
  }
}
Accessor.Type = {
  /** Scalar, having 1 value per element. */
  SCALAR: "SCALAR",
  /** 2-component vector, having 2 components per element. */
  VEC2: "VEC2",
  /** 3-component vector, having 3 components per element. */
  VEC3: "VEC3",
  /** 4-component vector, having 4 components per element. */
  VEC4: "VEC4",
  /** 2x2 matrix, having 4 components per element. */
  MAT2: "MAT2",
  /** 3x3 matrix, having 9 components per element. */
  MAT3: "MAT3",
  /** 4x3 matrix, having 16 components per element. */
  MAT4: "MAT4"
};
Accessor.ComponentType = {
  /**
   * 1-byte signed integer, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int8Array Int8Array}.
   */
  BYTE: 5120,
  /**
   * 1-byte unsigned integer, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array Uint8Array}.
   */
  UNSIGNED_BYTE: 5121,
  /**
   * 2-byte signed integer, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Int16Array Int16Array}.
   */
  SHORT: 5122,
  /**
   * 2-byte unsigned integer, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint16Array Uint16Array}.
   */
  UNSIGNED_SHORT: 5123,
  /**
   * 4-byte unsigned integer, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array Uint32Array}.
   */
  UNSIGNED_INT: 5125,
  /**
   * 4-byte floating point number, stored as
   * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Float32Array Float32Array}.
   */
  FLOAT: 5126
};
function arrayToComponentType(array) {
  switch (array.constructor) {
    case Float32Array:
      return Accessor.ComponentType.FLOAT;
    case Uint32Array:
      return Accessor.ComponentType.UNSIGNED_INT;
    case Uint16Array:
      return Accessor.ComponentType.UNSIGNED_SHORT;
    case Uint8Array:
      return Accessor.ComponentType.UNSIGNED_BYTE;
    case Int16Array:
      return Accessor.ComponentType.SHORT;
    case Int8Array:
      return Accessor.ComponentType.BYTE;
    default:
      throw new Error("Unknown accessor componentType.");
  }
}
class Animation extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.ANIMATION;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      channels: new RefSet(),
      samplers: new RefSet()
    });
  }
  /** Adds an {@link AnimationChannel} to this Animation. */
  addChannel(channel) {
    return this.addRef("channels", channel);
  }
  /** Removes an {@link AnimationChannel} from this Animation. */
  removeChannel(channel) {
    return this.removeRef("channels", channel);
  }
  /** Lists {@link AnimationChannel}s in this Animation. */
  listChannels() {
    return this.listRefs("channels");
  }
  /** Adds an {@link AnimationSampler} to this Animation. */
  addSampler(sampler) {
    return this.addRef("samplers", sampler);
  }
  /** Removes an {@link AnimationSampler} from this Animation. */
  removeSampler(sampler) {
    return this.removeRef("samplers", sampler);
  }
  /** Lists {@link AnimationSampler}s in this Animation. */
  listSamplers() {
    return this.listRefs("samplers");
  }
}
class AnimationChannel extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.ANIMATION_CHANNEL;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      targetPath: null,
      targetNode: null,
      sampler: null
    });
  }
  /**********************************************************************************************
   * Properties.
   */
  /**
   * Path (property) animated on the target {@link Node}. Supported values include:
   * `translation`, `rotation`, `scale`, or `weights`.
   */
  getTargetPath() {
    return this.get("targetPath");
  }
  /**
   * Path (property) animated on the target {@link Node}. Supported values include:
   * `translation`, `rotation`, `scale`, or `weights`.
   */
  setTargetPath(targetPath) {
    return this.set("targetPath", targetPath);
  }
  /** Target {@link Node} animated by the channel. */
  getTargetNode() {
    return this.getRef("targetNode");
  }
  /** Target {@link Node} animated by the channel. */
  setTargetNode(targetNode) {
    return this.setRef("targetNode", targetNode);
  }
  /**
   * Keyframe data input/output values for the channel. Must be attached to the same
   * {@link Animation}.
   */
  getSampler() {
    return this.getRef("sampler");
  }
  /**
   * Keyframe data input/output values for the channel. Must be attached to the same
   * {@link Animation}.
   */
  setSampler(sampler) {
    return this.setRef("sampler", sampler);
  }
}
AnimationChannel.TargetPath = {
  /** Channel targets {@link Node.setTranslation}. */
  TRANSLATION: "translation",
  /** Channel targets {@link Node.setRotation}. */
  ROTATION: "rotation",
  /** Channel targets {@link Node.setScale}. */
  SCALE: "scale",
  /** Channel targets {@link Node.setWeights}, affecting {@link PrimitiveTarget} weights. */
  WEIGHTS: "weights"
};
class AnimationSampler extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.ANIMATION_SAMPLER;
  }
  getDefaultAttributes() {
    return Object.assign(super.getDefaults(), {
      interpolation: AnimationSampler.Interpolation.LINEAR,
      input: null,
      output: null
    });
  }
  /**********************************************************************************************
   * Static.
   */
  /** Interpolation mode: `STEP`, `LINEAR`, or `CUBICSPLINE`. */
  getInterpolation() {
    return this.get("interpolation");
  }
  /** Interpolation mode: `STEP`, `LINEAR`, or `CUBICSPLINE`. */
  setInterpolation(interpolation) {
    return this.set("interpolation", interpolation);
  }
  /** Times for each keyframe, in seconds. */
  getInput() {
    return this.getRef("input");
  }
  /** Times for each keyframe, in seconds. */
  setInput(input) {
    return this.setRef("input", input, {
      usage: BufferViewUsage$1.OTHER
    });
  }
  /**
   * Values for each keyframe. For `CUBICSPLINE` interpolation, output also contains in/out
   * tangents.
   */
  getOutput() {
    return this.getRef("output");
  }
  /**
   * Values for each keyframe. For `CUBICSPLINE` interpolation, output also contains in/out
   * tangents.
   */
  setOutput(output) {
    return this.setRef("output", output, {
      usage: BufferViewUsage$1.OTHER
    });
  }
}
AnimationSampler.Interpolation = {
  /** Animated values are linearly interpolated between keyframes. */
  LINEAR: "LINEAR",
  /** Animated values remain constant from one keyframe until the next keyframe. */
  STEP: "STEP",
  /** Animated values are interpolated according to given cubic spline tangents. */
  CUBICSPLINE: "CUBICSPLINE"
};
class Buffer$1 extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.BUFFER;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      uri: ""
    });
  }
  /**
   * Returns the URI (or filename) of this buffer (e.g. 'myBuffer.bin'). URIs are strongly
   * encouraged to be relative paths, rather than absolute. Use of a protocol (like `file://`)
   * is possible for custom applications, but will limit the compatibility of the asset with most
   * tools.
   *
   * Buffers commonly use the extension `.bin`, though this is not required.
   */
  getURI() {
    return this.get("uri");
  }
  /**
   * Sets the URI (or filename) of this buffer (e.g. 'myBuffer.bin'). URIs are strongly
   * encouraged to be relative paths, rather than absolute. Use of a protocol (like `file://`)
   * is possible for custom applications, but will limit the compatibility of the asset with most
   * tools.
   *
   * Buffers commonly use the extension `.bin`, though this is not required.
   */
  setURI(uri) {
    return this.set("uri", uri);
  }
}
class Camera extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.CAMERA;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      // Common.
      type: Camera.Type.PERSPECTIVE,
      znear: 0.1,
      zfar: 100,
      // Perspective.
      aspectRatio: null,
      yfov: Math.PI * 2 * 50 / 360,
      // 50º
      // Orthographic.
      xmag: 1,
      ymag: 1
    });
  }
  /**********************************************************************************************
   * Common.
   */
  /** Specifies if the camera uses a perspective or orthographic projection. */
  getType() {
    return this.get("type");
  }
  /** Specifies if the camera uses a perspective or orthographic projection. */
  setType(type) {
    return this.set("type", type);
  }
  /** Floating-point distance to the near clipping plane. */
  getZNear() {
    return this.get("znear");
  }
  /** Floating-point distance to the near clipping plane. */
  setZNear(znear) {
    return this.set("znear", znear);
  }
  /**
   * Floating-point distance to the far clipping plane. When defined, zfar must be greater than
   * znear. If zfar is undefined, runtime must use infinite projection matrix.
   */
  getZFar() {
    return this.get("zfar");
  }
  /**
   * Floating-point distance to the far clipping plane. When defined, zfar must be greater than
   * znear. If zfar is undefined, runtime must use infinite projection matrix.
   */
  setZFar(zfar) {
    return this.set("zfar", zfar);
  }
  /**********************************************************************************************
   * Perspective.
   */
  /**
   * Floating-point aspect ratio of the field of view. When undefined, the aspect ratio of the
   * canvas is used.
   */
  getAspectRatio() {
    return this.get("aspectRatio");
  }
  /**
   * Floating-point aspect ratio of the field of view. When undefined, the aspect ratio of the
   * canvas is used.
   */
  setAspectRatio(aspectRatio) {
    return this.set("aspectRatio", aspectRatio);
  }
  /** Floating-point vertical field of view in radians. */
  getYFov() {
    return this.get("yfov");
  }
  /** Floating-point vertical field of view in radians. */
  setYFov(yfov) {
    return this.set("yfov", yfov);
  }
  /**********************************************************************************************
   * Orthographic.
   */
  /**
   * Floating-point horizontal magnification of the view, and half the view's width
   * in world units.
   */
  getXMag() {
    return this.get("xmag");
  }
  /**
   * Floating-point horizontal magnification of the view, and half the view's width
   * in world units.
   */
  setXMag(xmag) {
    return this.set("xmag", xmag);
  }
  /**
   * Floating-point vertical magnification of the view, and half the view's height
   * in world units.
   */
  getYMag() {
    return this.get("ymag");
  }
  /**
   * Floating-point vertical magnification of the view, and half the view's height
   * in world units.
   */
  setYMag(ymag) {
    return this.set("ymag", ymag);
  }
}
Camera.Type = {
  /** A perspective camera representing a perspective projection matrix. */
  PERSPECTIVE: "perspective",
  /** An orthographic camera representing an orthographic projection matrix. */
  ORTHOGRAPHIC: "orthographic"
};
class ExtensionProperty extends Property {
  /** @hidden */
  _validateParent(parent) {
    if (!this.parentTypes.includes(parent.propertyType)) {
      throw new Error(`Parent "${parent.propertyType}" invalid for child "${this.propertyType}".`);
    }
  }
}
ExtensionProperty.EXTENSION_NAME = void 0;
class TextureInfo extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.TEXTURE_INFO;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      texCoord: 0,
      magFilter: null,
      minFilter: null,
      wrapS: TextureInfo.WrapMode.REPEAT,
      wrapT: TextureInfo.WrapMode.REPEAT
    });
  }
  /**********************************************************************************************
   * Texture coordinates.
   */
  /** Returns the texture coordinate (UV set) index for the texture. */
  getTexCoord() {
    return this.get("texCoord");
  }
  /** Sets the texture coordinate (UV set) index for the texture. */
  setTexCoord(texCoord) {
    return this.set("texCoord", texCoord);
  }
  /**********************************************************************************************
   * Min/mag filter.
   */
  /** Returns the magnification filter applied to the texture. */
  getMagFilter() {
    return this.get("magFilter");
  }
  /** Sets the magnification filter applied to the texture. */
  setMagFilter(magFilter) {
    return this.set("magFilter", magFilter);
  }
  /** Sets the minification filter applied to the texture. */
  getMinFilter() {
    return this.get("minFilter");
  }
  /** Returns the minification filter applied to the texture. */
  setMinFilter(minFilter) {
    return this.set("minFilter", minFilter);
  }
  /**********************************************************************************************
   * UV wrapping.
   */
  /** Returns the S (U) wrapping mode for UVs used by the texture. */
  getWrapS() {
    return this.get("wrapS");
  }
  /** Sets the S (U) wrapping mode for UVs used by the texture. */
  setWrapS(wrapS) {
    return this.set("wrapS", wrapS);
  }
  /** Returns the T (V) wrapping mode for UVs used by the texture. */
  getWrapT() {
    return this.get("wrapT");
  }
  /** Sets the T (V) wrapping mode for UVs used by the texture. */
  setWrapT(wrapT) {
    return this.set("wrapT", wrapT);
  }
}
TextureInfo.WrapMode = {
  /** */
  CLAMP_TO_EDGE: 33071,
  /** */
  MIRRORED_REPEAT: 33648,
  /** */
  REPEAT: 10497
};
TextureInfo.MagFilter = {
  /** */
  NEAREST: 9728,
  /** */
  LINEAR: 9729
};
TextureInfo.MinFilter = {
  /** */
  NEAREST: 9728,
  /** */
  LINEAR: 9729,
  /** */
  NEAREST_MIPMAP_NEAREST: 9984,
  /** */
  LINEAR_MIPMAP_NEAREST: 9985,
  /** */
  NEAREST_MIPMAP_LINEAR: 9986,
  /** */
  LINEAR_MIPMAP_LINEAR: 9987
};
const {
  R,
  G,
  B,
  A
} = TextureChannel;
class Material extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.MATERIAL;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      alphaMode: Material.AlphaMode.OPAQUE,
      alphaCutoff: 0.5,
      doubleSided: false,
      baseColorFactor: [1, 1, 1, 1],
      baseColorTexture: null,
      baseColorTextureInfo: new TextureInfo(this.graph, "baseColorTextureInfo"),
      emissiveFactor: [0, 0, 0],
      emissiveTexture: null,
      emissiveTextureInfo: new TextureInfo(this.graph, "emissiveTextureInfo"),
      normalScale: 1,
      normalTexture: null,
      normalTextureInfo: new TextureInfo(this.graph, "normalTextureInfo"),
      occlusionStrength: 1,
      occlusionTexture: null,
      occlusionTextureInfo: new TextureInfo(this.graph, "occlusionTextureInfo"),
      roughnessFactor: 1,
      metallicFactor: 1,
      metallicRoughnessTexture: null,
      metallicRoughnessTextureInfo: new TextureInfo(this.graph, "metallicRoughnessTextureInfo")
    });
  }
  /**********************************************************************************************
   * Double-sided / culling.
   */
  /** Returns true when both sides of triangles should be rendered. May impact performance. */
  getDoubleSided() {
    return this.get("doubleSided");
  }
  /** Sets whether to render both sides of triangles. May impact performance. */
  setDoubleSided(doubleSided) {
    return this.set("doubleSided", doubleSided);
  }
  /**********************************************************************************************
   * Alpha.
   */
  /** Returns material alpha, equivalent to baseColorFactor[3]. */
  getAlpha() {
    return this.get("baseColorFactor")[3];
  }
  /** Sets material alpha, equivalent to baseColorFactor[3]. */
  setAlpha(alpha) {
    const baseColorFactor = this.get("baseColorFactor").slice();
    baseColorFactor[3] = alpha;
    return this.set("baseColorFactor", baseColorFactor);
  }
  /**
   * Returns the mode of the material's alpha channels, which are provided by `baseColorFactor`
   * and `baseColorTexture`.
   *
   * - `OPAQUE`: Alpha value is ignored and the rendered output is fully opaque.
   * - `BLEND`: Alpha value is used to determine the transparency each pixel on a surface, and
   * 	the fraction of surface vs. background color in the final result. Alpha blending creates
   *	significant edge cases in realtime renderers, and some care when structuring the model is
   * 	necessary for good results. In particular, transparent geometry should be kept in separate
   * 	meshes or primitives from opaque geometry. The `depthWrite` or `zWrite` settings in engines
   * 	should usually be disabled on transparent materials.
   * - `MASK`: Alpha value is compared against `alphaCutoff` threshold for each pixel on a
   * 	surface, and the pixel is either fully visible or fully discarded based on that cutoff.
   * 	This technique is useful for things like leafs/foliage, grass, fabric meshes, and other
   * 	surfaces where no semitransparency is needed. With a good choice of `alphaCutoff`, surfaces
   * 	that don't require semitransparency can avoid the performance penalties and visual issues
   * 	involved with `BLEND` transparency.
   *
   * Reference:
   * - [glTF → material.alphaMode](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialalphamode)
   */
  getAlphaMode() {
    return this.get("alphaMode");
  }
  /** Sets the mode of the material's alpha channels. See {@link Material.getAlphaMode getAlphaMode} for details. */
  setAlphaMode(alphaMode) {
    return this.set("alphaMode", alphaMode);
  }
  /** Returns the visibility threshold; applied only when `.alphaMode='MASK'`. */
  getAlphaCutoff() {
    return this.get("alphaCutoff");
  }
  /** Sets the visibility threshold; applied only when `.alphaMode='MASK'`. */
  setAlphaCutoff(alphaCutoff) {
    return this.set("alphaCutoff", alphaCutoff);
  }
  /**********************************************************************************************
   * Base color.
   */
  /**
   * Base color / albedo factor; Linear-sRGB components.
   * See {@link Material.getBaseColorTexture getBaseColorTexture}.
   */
  getBaseColorFactor() {
    return this.get("baseColorFactor");
  }
  /**
   * Base color / albedo factor; Linear-sRGB components.
   * See {@link Material.getBaseColorTexture getBaseColorTexture}.
   */
  setBaseColorFactor(baseColorFactor) {
    return this.set("baseColorFactor", baseColorFactor);
  }
  /**
   * Base color / albedo. The visible color of a non-metallic surface under constant ambient
   * light would be a linear combination (multiplication) of its vertex colors, base color
   * factor, and base color texture. Lighting, and reflections in metallic or smooth surfaces,
   * also effect the final color. The alpha (`.a`) channel of base color factors and textures
   * will have varying effects, based on the setting of {@link Material.getAlphaMode getAlphaMode}.
   *
   * Reference:
   * - [glTF → material.pbrMetallicRoughness.baseColorFactor](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#pbrmetallicroughnessbasecolorfactor)
   */
  getBaseColorTexture() {
    return this.getRef("baseColorTexture");
  }
  /**
   * Settings affecting the material's use of its base color texture. If no texture is attached,
   * {@link TextureInfo} is `null`.
   */
  getBaseColorTextureInfo() {
    return this.getRef("baseColorTexture") ? this.getRef("baseColorTextureInfo") : null;
  }
  /** Sets base color / albedo texture. See {@link Material.getBaseColorTexture getBaseColorTexture}. */
  setBaseColorTexture(texture) {
    return this.setRef("baseColorTexture", texture, {
      channels: R | G | B | A,
      isColor: true
    });
  }
  /**********************************************************************************************
   * Emissive.
   */
  /** Emissive color; Linear-sRGB components. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  getEmissiveFactor() {
    return this.get("emissiveFactor");
  }
  /** Emissive color; Linear-sRGB components. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  setEmissiveFactor(emissiveFactor) {
    return this.set("emissiveFactor", emissiveFactor);
  }
  /**
   * Emissive texture. Emissive color is added to any base color of the material, after any
   * lighting/shadowing are applied. An emissive color does not inherently "glow", or affect
   * objects around it at all. To create that effect, most viewers must also enable a
   * post-processing effect called "bloom".
   *
   * Reference:
   * - [glTF → material.emissiveTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialemissivetexture)
   */
  getEmissiveTexture() {
    return this.getRef("emissiveTexture");
  }
  /**
   * Settings affecting the material's use of its emissive texture. If no texture is attached,
   * {@link TextureInfo} is `null`.
   */
  getEmissiveTextureInfo() {
    return this.getRef("emissiveTexture") ? this.getRef("emissiveTextureInfo") : null;
  }
  /** Sets emissive texture. See {@link Material.getEmissiveTexture getEmissiveTexture}. */
  setEmissiveTexture(texture) {
    return this.setRef("emissiveTexture", texture, {
      channels: R | G | B,
      isColor: true
    });
  }
  /**********************************************************************************************
   * Normal.
   */
  /** Normal (surface detail) factor; linear multiplier. Affects `.normalTexture`. */
  getNormalScale() {
    return this.get("normalScale");
  }
  /** Normal (surface detail) factor; linear multiplier. Affects `.normalTexture`. */
  setNormalScale(scale) {
    return this.set("normalScale", scale);
  }
  /**
   * Normal (surface detail) texture.
   *
   * A tangent space normal map. The texture contains RGB components. Each texel represents the
   * XYZ components of a normal vector in tangent space. Red [0 to 255] maps to X [-1 to 1].
   * Green [0 to 255] maps to Y [-1 to 1]. Blue [128 to 255] maps to Z [1/255 to 1]. The normal
   * vectors use OpenGL conventions where +X is right and +Y is up. +Z points toward the viewer.
   *
   * Reference:
   * - [glTF → material.normalTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialnormaltexture)
   */
  getNormalTexture() {
    return this.getRef("normalTexture");
  }
  /**
   * Settings affecting the material's use of its normal texture. If no texture is attached,
   * {@link TextureInfo} is `null`.
   */
  getNormalTextureInfo() {
    return this.getRef("normalTexture") ? this.getRef("normalTextureInfo") : null;
  }
  /** Sets normal (surface detail) texture. See {@link Material.getNormalTexture getNormalTexture}. */
  setNormalTexture(texture) {
    return this.setRef("normalTexture", texture, {
      channels: R | G | B
    });
  }
  /**********************************************************************************************
   * Occlusion.
   */
  /** (Ambient) Occlusion factor; linear multiplier. Affects `.occlusionTexture`. */
  getOcclusionStrength() {
    return this.get("occlusionStrength");
  }
  /** Sets (ambient) occlusion factor; linear multiplier. Affects `.occlusionTexture`. */
  setOcclusionStrength(strength) {
    return this.set("occlusionStrength", strength);
  }
  /**
   * (Ambient) Occlusion texture, generally used for subtle 'baked' shadowing effects that are
   * independent of an object's position, such as shading in inset areas and corners. Direct
   * lighting is not affected by occlusion, so at least one indirect light source must be present
   * in the scene for occlusion effects to be visible.
   *
   * The occlusion values are sampled from the R channel. Higher values indicate areas that
   * should receive full indirect lighting and lower values indicate no indirect lighting.
   *
   * Reference:
   * - [glTF → material.occlusionTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#materialocclusiontexture)
   */
  getOcclusionTexture() {
    return this.getRef("occlusionTexture");
  }
  /**
   * Settings affecting the material's use of its occlusion texture. If no texture is attached,
   * {@link TextureInfo} is `null`.
   */
  getOcclusionTextureInfo() {
    return this.getRef("occlusionTexture") ? this.getRef("occlusionTextureInfo") : null;
  }
  /** Sets (ambient) occlusion texture. See {@link Material.getOcclusionTexture getOcclusionTexture}. */
  setOcclusionTexture(texture) {
    return this.setRef("occlusionTexture", texture, {
      channels: R
    });
  }
  /**********************************************************************************************
   * Metallic / roughness.
   */
  /**
   * Roughness factor; linear multiplier. Affects roughness channel of
   * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
   */
  getRoughnessFactor() {
    return this.get("roughnessFactor");
  }
  /**
   * Sets roughness factor; linear multiplier. Affects roughness channel of
   * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
   */
  setRoughnessFactor(factor) {
    return this.set("roughnessFactor", factor);
  }
  /**
   * Metallic factor; linear multiplier. Affects roughness channel of
   * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
   */
  getMetallicFactor() {
    return this.get("metallicFactor");
  }
  /**
   * Sets metallic factor; linear multiplier. Affects roughness channel of
   * `metallicRoughnessTexture`. See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
   */
  setMetallicFactor(factor) {
    return this.set("metallicFactor", factor);
  }
  /**
   * Metallic roughness texture. The metalness values are sampled from the B channel. The
   * roughness values are sampled from the G channel. When a material is fully metallic,
   * or nearly so, it may require image-based lighting (i.e. an environment map) or global
   * illumination to appear well-lit.
   *
   * Reference:
   * - [glTF → material.pbrMetallicRoughness.metallicRoughnessTexture](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#pbrmetallicroughnessmetallicroughnesstexture)
   */
  getMetallicRoughnessTexture() {
    return this.getRef("metallicRoughnessTexture");
  }
  /**
   * Settings affecting the material's use of its metallic/roughness texture. If no texture is
   * attached, {@link TextureInfo} is `null`.
   */
  getMetallicRoughnessTextureInfo() {
    return this.getRef("metallicRoughnessTexture") ? this.getRef("metallicRoughnessTextureInfo") : null;
  }
  /**
   * Sets metallic/roughness texture.
   * See {@link Material.getMetallicRoughnessTexture getMetallicRoughnessTexture}.
   */
  setMetallicRoughnessTexture(texture) {
    return this.setRef("metallicRoughnessTexture", texture, {
      channels: G | B
    });
  }
}
Material.AlphaMode = {
  /**
   * The alpha value is ignored and the rendered output is fully opaque
   */
  OPAQUE: "OPAQUE",
  /**
   * The rendered output is either fully opaque or fully transparent depending on the alpha
   * value and the specified alpha cutoff value
   */
  MASK: "MASK",
  /**
   * The alpha value is used to composite the source and destination areas. The rendered
   * output is combined with the background using the normal painting operation (i.e. the
   * Porter and Duff over operator)
   */
  BLEND: "BLEND"
};
class Mesh extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.MESH;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      weights: [],
      primitives: new RefSet()
    });
  }
  /** Adds a {@link Primitive} to the mesh's draw call list. */
  addPrimitive(primitive) {
    return this.addRef("primitives", primitive);
  }
  /** Removes a {@link Primitive} from the mesh's draw call list. */
  removePrimitive(primitive) {
    return this.removeRef("primitives", primitive);
  }
  /** Lists {@link Primitive} draw calls of the mesh. */
  listPrimitives() {
    return this.listRefs("primitives");
  }
  /**
   * Initial weights of each {@link PrimitiveTarget} on this mesh. Each {@link Primitive} must
   * have the same number of targets. Most engines only support 4-8 active morph targets at a
   * time.
   */
  getWeights() {
    return this.get("weights");
  }
  /**
   * Initial weights of each {@link PrimitiveTarget} on this mesh. Each {@link Primitive} must
   * have the same number of targets. Most engines only support 4-8 active morph targets at a
   * time.
   */
  setWeights(weights) {
    return this.set("weights", weights);
  }
}
class Node extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.NODE;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      weights: [],
      camera: null,
      mesh: null,
      skin: null,
      children: new RefSet()
    });
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Node cannot be copied.");
    return super.copy(other, resolve);
  }
  /**********************************************************************************************
   * Local transform.
   */
  /** Returns the translation (position) of this Node in local space. */
  getTranslation() {
    return this.get("translation");
  }
  /** Returns the rotation (quaternion) of this Node in local space. */
  getRotation() {
    return this.get("rotation");
  }
  /** Returns the scale of this Node in local space. */
  getScale() {
    return this.get("scale");
  }
  /** Sets the translation (position) of this Node in local space. */
  setTranslation(translation) {
    return this.set("translation", translation);
  }
  /** Sets the rotation (quaternion) of this Node in local space. */
  setRotation(rotation) {
    return this.set("rotation", rotation);
  }
  /** Sets the scale of this Node in local space. */
  setScale(scale) {
    return this.set("scale", scale);
  }
  /** Returns the local matrix of this Node. */
  getMatrix() {
    return MathUtils.compose(this.get("translation"), this.get("rotation"), this.get("scale"), []);
  }
  /** Sets the local matrix of this Node. Matrix will be decomposed to TRS properties. */
  setMatrix(matrix) {
    const translation = this.get("translation").slice();
    const rotation = this.get("rotation").slice();
    const scale = this.get("scale").slice();
    MathUtils.decompose(matrix, translation, rotation, scale);
    return this.set("translation", translation).set("rotation", rotation).set("scale", scale);
  }
  /**********************************************************************************************
   * World transform.
   */
  /** Returns the translation (position) of this Node in world space. */
  getWorldTranslation() {
    const t = [0, 0, 0];
    MathUtils.decompose(this.getWorldMatrix(), t, [0, 0, 0, 1], [1, 1, 1]);
    return t;
  }
  /** Returns the rotation (quaternion) of this Node in world space. */
  getWorldRotation() {
    const r = [0, 0, 0, 1];
    MathUtils.decompose(this.getWorldMatrix(), [0, 0, 0], r, [1, 1, 1]);
    return r;
  }
  /** Returns the scale of this Node in world space. */
  getWorldScale() {
    const s = [1, 1, 1];
    MathUtils.decompose(this.getWorldMatrix(), [0, 0, 0], [0, 0, 0, 1], s);
    return s;
  }
  /** Returns the world matrix of this Node. */
  getWorldMatrix() {
    const ancestors = [];
    for (let node = this; node != null; node = node.getParentNode()) {
      ancestors.push(node);
    }
    let ancestor;
    const worldMatrix = ancestors.pop().getMatrix();
    while (ancestor = ancestors.pop()) {
      multiply(worldMatrix, worldMatrix, ancestor.getMatrix());
    }
    return worldMatrix;
  }
  /**********************************************************************************************
   * Scene hierarchy.
   */
  /**
   * Adds the given Node as a child of this Node.
   *
   * Requirements:
   *
   * 1. Nodes MAY be root children of multiple {@link Scene Scenes}
   * 2. Nodes MUST NOT be children of >1 Node
   * 3. Nodes MUST NOT be children of both Nodes and {@link Scene Scenes}
   *
   * The `addChild` method enforces these restrictions automatically, and will
   * remove the new child from previous parents where needed. This behavior
   * may change in future major releases of the library.
   */
  addChild(child) {
    const parentNode = child.getParentNode();
    if (parentNode) parentNode.removeChild(child);
    for (const parent of child.listParents()) {
      if (parent.propertyType === PropertyType.SCENE) {
        parent.removeChild(child);
      }
    }
    return this.addRef("children", child);
  }
  /** Removes a Node from this Node's child Node list. */
  removeChild(child) {
    return this.removeRef("children", child);
  }
  /** Lists all child Nodes of this Node. */
  listChildren() {
    return this.listRefs("children");
  }
  /**
   * Returns the Node's unique parent Node within the scene graph. If the
   * Node has no parents, or is a direct child of the {@link Scene}
   * ("root node"), this method returns null.
   *
   * Unrelated to {@link Property.listParents}, which lists all resource
   * references from properties of any type ({@link Skin}, {@link Root}, ...).
   */
  getParentNode() {
    for (const parent of this.listParents()) {
      if (parent.propertyType === PropertyType.NODE) {
        return parent;
      }
    }
    return null;
  }
  /**********************************************************************************************
   * Attachments.
   */
  /** Returns the {@link Mesh}, if any, instantiated at this Node. */
  getMesh() {
    return this.getRef("mesh");
  }
  /**
   * Sets a {@link Mesh} to be instantiated at this Node. A single mesh may be instantiated by
   * multiple Nodes; reuse of this sort is strongly encouraged.
   */
  setMesh(mesh) {
    return this.setRef("mesh", mesh);
  }
  /** Returns the {@link Camera}, if any, instantiated at this Node. */
  getCamera() {
    return this.getRef("camera");
  }
  /** Sets a {@link Camera} to be instantiated at this Node. */
  setCamera(camera) {
    return this.setRef("camera", camera);
  }
  /** Returns the {@link Skin}, if any, instantiated at this Node. */
  getSkin() {
    return this.getRef("skin");
  }
  /** Sets a {@link Skin} to be instantiated at this Node. */
  setSkin(skin) {
    return this.setRef("skin", skin);
  }
  /**
   * Initial weights of each {@link PrimitiveTarget} for the mesh instance at this Node.
   * Most engines only support 4-8 active morph targets at a time.
   */
  getWeights() {
    return this.get("weights");
  }
  /**
   * Initial weights of each {@link PrimitiveTarget} for the mesh instance at this Node.
   * Most engines only support 4-8 active morph targets at a time.
   */
  setWeights(weights) {
    return this.set("weights", weights);
  }
  /**********************************************************************************************
   * Helpers.
   */
  /** Visits this {@link Node} and its descendants, top-down. */
  traverse(fn) {
    fn(this);
    for (const child of this.listChildren()) child.traverse(fn);
    return this;
  }
}
class Primitive extends ExtensibleProperty {
  /**********************************************************************************************
   * Instance.
   */
  init() {
    this.propertyType = PropertyType.PRIMITIVE;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      mode: Primitive.Mode.TRIANGLES,
      material: null,
      indices: null,
      attributes: new RefMap(),
      targets: new RefSet()
    });
  }
  /**********************************************************************************************
   * Primitive data.
   */
  /** Returns an {@link Accessor} with indices of vertices to be drawn. */
  getIndices() {
    return this.getRef("indices");
  }
  /**
   * Sets an {@link Accessor} with indices of vertices to be drawn. In `TRIANGLES` draw mode,
   * each set of three indices define a triangle. The front face has a counter-clockwise (CCW)
   * winding order.
   */
  setIndices(indices) {
    return this.setRef("indices", indices, {
      usage: BufferViewUsage$1.ELEMENT_ARRAY_BUFFER
    });
  }
  /** Returns a vertex attribute as an {@link Accessor}. */
  getAttribute(semantic) {
    return this.getRefMap("attributes", semantic);
  }
  /**
   * Sets a vertex attribute to an {@link Accessor}. All attributes must have the same vertex
   * count.
   */
  setAttribute(semantic, accessor) {
    return this.setRefMap("attributes", semantic, accessor, {
      usage: BufferViewUsage$1.ARRAY_BUFFER
    });
  }
  /**
   * Lists all vertex attribute {@link Accessor}s associated with the primitive, excluding any
   * attributes used for morph targets. For example, `[positionAccessor, normalAccessor,
   * uvAccessor]`. Order will be consistent with the order returned by {@link .listSemantics}().
   */
  listAttributes() {
    return this.listRefMapValues("attributes");
  }
  /**
   * Lists all vertex attribute semantics associated with the primitive, excluding any semantics
   * used for morph targets. For example, `['POSITION', 'NORMAL', 'TEXCOORD_0']`. Order will be
   * consistent with the order returned by {@link .listAttributes}().
   */
  listSemantics() {
    return this.listRefMapKeys("attributes");
  }
  /** Returns the material used to render the primitive. */
  getMaterial() {
    return this.getRef("material");
  }
  /** Sets the material used to render the primitive. */
  setMaterial(material) {
    return this.setRef("material", material);
  }
  /**********************************************************************************************
   * Mode.
   */
  /**
   * Returns the GPU draw mode (`TRIANGLES`, `LINES`, `POINTS`...) as a WebGL enum value.
   *
   * Reference:
   * - [glTF → `primitive.mode`](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#primitivemode)
   */
  getMode() {
    return this.get("mode");
  }
  /**
   * Sets the GPU draw mode (`TRIANGLES`, `LINES`, `POINTS`...) as a WebGL enum value.
   *
   * Reference:
   * - [glTF → `primitive.mode`](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#primitivemode)
   */
  setMode(mode) {
    return this.set("mode", mode);
  }
  /**********************************************************************************************
   * Morph targets.
   */
  /** Lists all morph targets associated with the primitive. */
  listTargets() {
    return this.listRefs("targets");
  }
  /**
   * Adds a morph target to the primitive. All primitives in the same mesh must have the same
   * number of targets.
   */
  addTarget(target) {
    return this.addRef("targets", target);
  }
  /**
   * Removes a morph target from the primitive. All primitives in the same mesh must have the same
   * number of targets.
   */
  removeTarget(target) {
    return this.removeRef("targets", target);
  }
}
Primitive.Mode = {
  /**
   * Each vertex defines a single point primitive.
   * Sequence: {0}, {1}, {2}, ... {i}
   */
  POINTS: 0,
  /**
   * Each consecutive pair of vertices defines a single line primitive.
   * Sequence: {0,1}, {2,3}, {4,5}, ... {i, i+1}
   */
  LINES: 1,
  /**
   * Each vertex is connected to the next, and the last vertex is connected to the first,
   * forming a closed loop of line primitives.
   * Sequence: {0,1}, {1,2}, {2,3}, ... {i, i+1}, {n–1, 0}
   *
   * @deprecated See {@link https://github.com/KhronosGroup/glTF/issues/1883 KhronosGroup/glTF#1883}.
   */
  LINE_LOOP: 2,
  /**
   * Each vertex is connected to the next, forming a contiguous series of line primitives.
   * Sequence: {0,1}, {1,2}, {2,3}, ... {i, i+1}
   */
  LINE_STRIP: 3,
  /**
   * Each consecutive set of three vertices defines a single triangle primitive.
   * Sequence: {0,1,2}, {3,4,5}, {6,7,8}, ... {i, i+1, i+2}
   */
  TRIANGLES: 4,
  /**
   * Each vertex defines one triangle primitive, using the two vertices that follow it.
   * Sequence: {0,1,2}, {1,3,2}, {2,3,4}, ... {i, i+(1+i%2), i+(2–i%2)}
   */
  TRIANGLE_STRIP: 5,
  /**
   * Each consecutive pair of vertices defines a triangle primitive sharing a common vertex at index 0.
   * Sequence: {1,2,0}, {2,3,0}, {3,4,0}, ... {i, i+1, 0}
   *
   * @deprecated See {@link https://github.com/KhronosGroup/glTF/issues/1883 KhronosGroup/glTF#1883}.
   */
  TRIANGLE_FAN: 6
};
class PrimitiveTarget extends Property {
  init() {
    this.propertyType = PropertyType.PRIMITIVE_TARGET;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      attributes: new RefMap()
    });
  }
  /** Returns a morph target vertex attribute as an {@link Accessor}. */
  getAttribute(semantic) {
    return this.getRefMap("attributes", semantic);
  }
  /**
   * Sets a morph target vertex attribute to an {@link Accessor}.
   */
  setAttribute(semantic, accessor) {
    return this.setRefMap("attributes", semantic, accessor, {
      usage: BufferViewUsage$1.ARRAY_BUFFER
    });
  }
  /**
   * Lists all morph target vertex attribute {@link Accessor}s associated. Order will be
   * consistent with the order returned by {@link .listSemantics}().
   */
  listAttributes() {
    return this.listRefMapValues("attributes");
  }
  /**
   * Lists all morph target vertex attribute semantics associated. Order will be
   * consistent with the order returned by {@link .listAttributes}().
   */
  listSemantics() {
    return this.listRefMapKeys("attributes");
  }
}
function _extends() {
  return _extends = Object.assign ? Object.assign.bind() : function(n) {
    for (var e = 1; e < arguments.length; e++) {
      var t = arguments[e];
      for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]);
    }
    return n;
  }, _extends.apply(null, arguments);
}
class Scene extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.SCENE;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      children: new RefSet()
    });
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Scene cannot be copied.");
    return super.copy(other, resolve);
  }
  /**
   * Adds a {@link Node} to the Scene.
   *
   * Requirements:
   *
   * 1. Nodes MAY be root children of multiple {@link Scene Scenes}
   * 2. Nodes MUST NOT be children of >1 Node
   * 3. Nodes MUST NOT be children of both Nodes and {@link Scene Scenes}
   *
   * The `addChild` method enforces these restrictions automatically, and will
   * remove the new child from previous parents where needed. This behavior
   * may change in future major releases of the library.
   */
  addChild(node) {
    const parentNode = node.getParentNode();
    if (parentNode) parentNode.removeChild(node);
    return this.addRef("children", node);
  }
  /** Removes a {@link Node} from the Scene. */
  removeChild(node) {
    return this.removeRef("children", node);
  }
  /**
   * Lists all direct child {@link Node Nodes} in the Scene. Indirect
   * descendants (children of children) are not returned, but may be
   * reached recursively or with {@link Scene.traverse} instead.
   */
  listChildren() {
    return this.listRefs("children");
  }
  /** Visits each {@link Node} in the Scene, including descendants, top-down. */
  traverse(fn) {
    for (const node of this.listChildren()) node.traverse(fn);
    return this;
  }
}
class Skin extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.SKIN;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      skeleton: null,
      inverseBindMatrices: null,
      joints: new RefSet()
    });
  }
  /**
   * {@link Node} used as a skeleton root. The node must be the closest common root of the joints
   * hierarchy or a direct or indirect parent node of the closest common root.
   */
  getSkeleton() {
    return this.getRef("skeleton");
  }
  /**
   * {@link Node} used as a skeleton root. The node must be the closest common root of the joints
   * hierarchy or a direct or indirect parent node of the closest common root.
   */
  setSkeleton(skeleton) {
    return this.setRef("skeleton", skeleton);
  }
  /**
   * {@link Accessor} containing the floating-point 4x4 inverse-bind matrices. The default is
   * that each matrix is a 4x4 identity matrix, which implies that inverse-bind matrices were
   * pre-applied.
   */
  getInverseBindMatrices() {
    return this.getRef("inverseBindMatrices");
  }
  /**
   * {@link Accessor} containing the floating-point 4x4 inverse-bind matrices. The default is
   * that each matrix is a 4x4 identity matrix, which implies that inverse-bind matrices were
   * pre-applied.
   */
  setInverseBindMatrices(inverseBindMatrices) {
    return this.setRef("inverseBindMatrices", inverseBindMatrices, {
      usage: BufferViewUsage$1.INVERSE_BIND_MATRICES
    });
  }
  /** Adds a joint {@link Node} to this {@link Skin}. */
  addJoint(joint) {
    return this.addRef("joints", joint);
  }
  /** Removes a joint {@link Node} from this {@link Skin}. */
  removeJoint(joint) {
    return this.removeRef("joints", joint);
  }
  /** Lists joints ({@link Node}s used as joints or bones) in this {@link Skin}. */
  listJoints() {
    return this.listRefs("joints");
  }
}
class Texture extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.TEXTURE;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      image: null,
      mimeType: "",
      uri: ""
    });
  }
  /**********************************************************************************************
   * MIME type / format.
   */
  /** Returns the MIME type for this texture ('image/jpeg' or 'image/png'). */
  getMimeType() {
    return this.get("mimeType") || ImageUtils.extensionToMimeType(FileUtils.extension(this.get("uri")));
  }
  /**
   * Sets the MIME type for this texture ('image/jpeg' or 'image/png'). If the texture does not
   * have a URI, a MIME type is required for correct export.
   */
  setMimeType(mimeType) {
    return this.set("mimeType", mimeType);
  }
  /**********************************************************************************************
   * URI / filename.
   */
  /** Returns the URI (e.g. 'path/to/file.png') for this texture. */
  getURI() {
    return this.get("uri");
  }
  /**
   * Sets the URI (e.g. 'path/to/file.png') for this texture. If the texture does not have a MIME
   * type, a URI is required for correct export.
   */
  setURI(uri) {
    this.set("uri", uri);
    const mimeType = ImageUtils.extensionToMimeType(FileUtils.extension(uri));
    if (mimeType) this.set("mimeType", mimeType);
    return this;
  }
  /**********************************************************************************************
   * Image data.
   */
  /** Returns the raw image data for this texture. */
  getImage() {
    return this.get("image");
  }
  /** Sets the raw image data for this texture. */
  setImage(image) {
    return this.set("image", BufferUtils.assertView(image));
  }
  /** Returns the size, in pixels, of this texture. */
  getSize() {
    const image = this.get("image");
    if (!image) return null;
    return ImageUtils.getSize(image, this.getMimeType());
  }
}
class Root extends ExtensibleProperty {
  init() {
    this.propertyType = PropertyType.ROOT;
  }
  getDefaults() {
    return Object.assign(super.getDefaults(), {
      asset: {
        generator: `glTF-Transform ${VERSION}`,
        version: "2.0"
      },
      defaultScene: null,
      accessors: new RefSet(),
      animations: new RefSet(),
      buffers: new RefSet(),
      cameras: new RefSet(),
      materials: new RefSet(),
      meshes: new RefSet(),
      nodes: new RefSet(),
      scenes: new RefSet(),
      skins: new RefSet(),
      textures: new RefSet()
    });
  }
  /** @internal */
  constructor(graph) {
    super(graph);
    this._extensions = /* @__PURE__ */ new Set();
    graph.addEventListener("node:create", (event) => {
      this._addChildOfRoot(event.target);
    });
  }
  clone() {
    throw new Error("Root cannot be cloned.");
  }
  copy(other, resolve = COPY_IDENTITY) {
    if (resolve === COPY_IDENTITY) throw new Error("Root cannot be copied.");
    this.set("asset", _extends({}, other.get("asset")));
    this.setName(other.getName());
    this.setExtras(_extends({}, other.getExtras()));
    this.setDefaultScene(other.getDefaultScene() ? resolve(other.getDefaultScene()) : null);
    for (const extensionName of other.listRefMapKeys("extensions")) {
      const otherExtension = other.getExtension(extensionName);
      this.setExtension(extensionName, resolve(otherExtension));
    }
    return this;
  }
  _addChildOfRoot(child) {
    if (child instanceof Scene) {
      this.addRef("scenes", child);
    } else if (child instanceof Node) {
      this.addRef("nodes", child);
    } else if (child instanceof Camera) {
      this.addRef("cameras", child);
    } else if (child instanceof Skin) {
      this.addRef("skins", child);
    } else if (child instanceof Mesh) {
      this.addRef("meshes", child);
    } else if (child instanceof Material) {
      this.addRef("materials", child);
    } else if (child instanceof Texture) {
      this.addRef("textures", child);
    } else if (child instanceof Animation) {
      this.addRef("animations", child);
    } else if (child instanceof Accessor) {
      this.addRef("accessors", child);
    } else if (child instanceof Buffer$1) {
      this.addRef("buffers", child);
    }
    return this;
  }
  /**
   * Returns the `asset` object, which specifies the target glTF version of the asset. Additional
   * metadata can be stored in optional properties such as `generator` or `copyright`.
   *
   * Reference: [glTF → Asset](https://github.com/KhronosGroup/gltf/blob/main/specification/2.0/README.md#asset)
   */
  getAsset() {
    return this.get("asset");
  }
  /**********************************************************************************************
   * Extensions.
   */
  /** Lists all {@link Extension Extensions} enabled for this root. */
  listExtensionsUsed() {
    return Array.from(this._extensions);
  }
  /** Lists all {@link Extension Extensions} enabled and required for this root. */
  listExtensionsRequired() {
    return this.listExtensionsUsed().filter((extension) => extension.isRequired());
  }
  /** @internal */
  _enableExtension(extension) {
    this._extensions.add(extension);
    return this;
  }
  /** @internal */
  _disableExtension(extension) {
    this._extensions.delete(extension);
    return this;
  }
  /**********************************************************************************************
   * Properties.
   */
  /** Lists all {@link Scene} properties associated with this root. */
  listScenes() {
    return this.listRefs("scenes");
  }
  /** Default {@link Scene} associated with this root. */
  setDefaultScene(defaultScene) {
    return this.setRef("defaultScene", defaultScene);
  }
  /** Default {@link Scene} associated with this root. */
  getDefaultScene() {
    return this.getRef("defaultScene");
  }
  /** Lists all {@link Node} properties associated with this root. */
  listNodes() {
    return this.listRefs("nodes");
  }
  /** Lists all {@link Camera} properties associated with this root. */
  listCameras() {
    return this.listRefs("cameras");
  }
  /** Lists all {@link Skin} properties associated with this root. */
  listSkins() {
    return this.listRefs("skins");
  }
  /** Lists all {@link Mesh} properties associated with this root. */
  listMeshes() {
    return this.listRefs("meshes");
  }
  /** Lists all {@link Material} properties associated with this root. */
  listMaterials() {
    return this.listRefs("materials");
  }
  /** Lists all {@link Texture} properties associated with this root. */
  listTextures() {
    return this.listRefs("textures");
  }
  /** Lists all {@link Animation} properties associated with this root. */
  listAnimations() {
    return this.listRefs("animations");
  }
  /** Lists all {@link Accessor} properties associated with this root. */
  listAccessors() {
    return this.listRefs("accessors");
  }
  /** Lists all {@link Buffer} properties associated with this root. */
  listBuffers() {
    return this.listRefs("buffers");
  }
}
class Document {
  /**
   * Returns the Document associated with a given Graph, if any.
   * @hidden
   * @experimental
   */
  static fromGraph(graph) {
    return Document._GRAPH_DOCUMENTS.get(graph) || null;
  }
  /** Creates a new Document, representing an empty glTF asset. */
  constructor() {
    this._graph = new Graph();
    this._root = new Root(this._graph);
    this._logger = Logger.DEFAULT_INSTANCE;
    Document._GRAPH_DOCUMENTS.set(this._graph, this);
  }
  /** Returns the glTF {@link Root} property. */
  getRoot() {
    return this._root;
  }
  /**
   * Returns the {@link Graph} representing connectivity of resources within this document.
   * @hidden
   */
  getGraph() {
    return this._graph;
  }
  /** Returns the {@link Logger} instance used for any operations performed on this document. */
  getLogger() {
    return this._logger;
  }
  /**
   * Overrides the {@link Logger} instance used for any operations performed on this document.
   *
   * Usage:
   *
   * ```ts
   * doc
   * 	.setLogger(new Logger(Logger.Verbosity.SILENT))
   * 	.transform(dedup(), weld());
   * ```
   */
  setLogger(logger) {
    this._logger = logger;
    return this;
  }
  /**
   * Clones this Document, copying all resources within it.
   * @deprecated Use 'cloneDocument(document)' from '@gltf-transform/functions'.
   * @hidden
   * @internal
   */
  clone() {
    throw new Error(`Use 'cloneDocument(source)' from '@gltf-transform/functions'.`);
  }
  /**
   * Merges the content of another Document into this one, without affecting the original.
   * @deprecated Use 'mergeDocuments(target, source)' from '@gltf-transform/functions'.
   * @hidden
   * @internal
   */
  merge(_other) {
    throw new Error(`Use 'mergeDocuments(target, source)' from '@gltf-transform/functions'.`);
  }
  /**
   * Applies a series of modifications to this document. Each transformation is asynchronous,
   * takes the {@link Document} as input, and returns nothing. Transforms are applied in the
   * order given, which may affect the final result.
   *
   * Usage:
   *
   * ```ts
   * await doc.transform(
   * 	dedup(),
   * 	prune()
   * );
   * ```
   *
   * @param transforms List of synchronous transformation functions to apply.
   */
  async transform(...transforms) {
    const stack = transforms.map((fn) => fn.name);
    for (const transform of transforms) {
      await transform(this, {
        stack
      });
    }
    return this;
  }
  /**********************************************************************************************
   * Extension factory methods.
   */
  /**
   * Creates a new {@link Extension}, for the extension type of the given constructor. If the
   * extension is already enabled for this Document, the previous Extension reference is reused.
   */
  createExtension(ctor) {
    const extensionName = ctor.EXTENSION_NAME;
    const prevExtension = this.getRoot().listExtensionsUsed().find((ext) => ext.extensionName === extensionName);
    return prevExtension || new ctor(this);
  }
  /**
   * Disables and removes an {@link Extension} from the Document. If no Extension exists with
   * the given name, this method has no effect.
   */
  disposeExtension(extensionName) {
    const extension = this.getRoot().listExtensionsUsed().find((ext) => ext.extensionName === extensionName);
    if (extension) extension.dispose();
  }
  /**********************************************************************************************
   * Property factory methods.
   */
  /** Creates a new {@link Scene} attached to this document's {@link Root}. */
  createScene(name = "") {
    return new Scene(this._graph, name);
  }
  /** Creates a new {@link Node} attached to this document's {@link Root}. */
  createNode(name = "") {
    return new Node(this._graph, name);
  }
  /** Creates a new {@link Camera} attached to this document's {@link Root}. */
  createCamera(name = "") {
    return new Camera(this._graph, name);
  }
  /** Creates a new {@link Skin} attached to this document's {@link Root}. */
  createSkin(name = "") {
    return new Skin(this._graph, name);
  }
  /** Creates a new {@link Mesh} attached to this document's {@link Root}. */
  createMesh(name = "") {
    return new Mesh(this._graph, name);
  }
  /**
   * Creates a new {@link Primitive}. Primitives must be attached to a {@link Mesh}
   * for use and export; they are not otherwise associated with a {@link Root}.
   */
  createPrimitive() {
    return new Primitive(this._graph);
  }
  /**
   * Creates a new {@link PrimitiveTarget}, or morph target. Targets must be attached to a
   * {@link Primitive} for use and export; they are not otherwise associated with a {@link Root}.
   */
  createPrimitiveTarget(name = "") {
    return new PrimitiveTarget(this._graph, name);
  }
  /** Creates a new {@link Material} attached to this document's {@link Root}. */
  createMaterial(name = "") {
    return new Material(this._graph, name);
  }
  /** Creates a new {@link Texture} attached to this document's {@link Root}. */
  createTexture(name = "") {
    return new Texture(this._graph, name);
  }
  /** Creates a new {@link Animation} attached to this document's {@link Root}. */
  createAnimation(name = "") {
    return new Animation(this._graph, name);
  }
  /**
   * Creates a new {@link AnimationChannel}. Channels must be attached to an {@link Animation}
   * for use and export; they are not otherwise associated with a {@link Root}.
   */
  createAnimationChannel(name = "") {
    return new AnimationChannel(this._graph, name);
  }
  /**
   * Creates a new {@link AnimationSampler}. Samplers must be attached to an {@link Animation}
   * for use and export; they are not otherwise associated with a {@link Root}.
   */
  createAnimationSampler(name = "") {
    return new AnimationSampler(this._graph, name);
  }
  /** Creates a new {@link Accessor} attached to this document's {@link Root}. */
  createAccessor(name = "", buffer = null) {
    if (!buffer) {
      buffer = this.getRoot().listBuffers()[0];
    }
    return new Accessor(this._graph, name).setBuffer(buffer);
  }
  /** Creates a new {@link Buffer} attached to this document's {@link Root}. */
  createBuffer(name = "") {
    return new Buffer$1(this._graph, name);
  }
}
Document._GRAPH_DOCUMENTS = /* @__PURE__ */ new WeakMap();
class ReaderContext {
  constructor(jsonDoc) {
    this.jsonDoc = void 0;
    this.buffers = [];
    this.bufferViews = [];
    this.bufferViewBuffers = [];
    this.accessors = [];
    this.textures = [];
    this.textureInfos = /* @__PURE__ */ new Map();
    this.materials = [];
    this.meshes = [];
    this.cameras = [];
    this.nodes = [];
    this.skins = [];
    this.animations = [];
    this.scenes = [];
    this.jsonDoc = jsonDoc;
  }
  setTextureInfo(textureInfo, textureInfoDef) {
    this.textureInfos.set(textureInfo, textureInfoDef);
    if (textureInfoDef.texCoord !== void 0) {
      textureInfo.setTexCoord(textureInfoDef.texCoord);
    }
    if (textureInfoDef.extras !== void 0) {
      textureInfo.setExtras(textureInfoDef.extras);
    }
    const textureDef = this.jsonDoc.json.textures[textureInfoDef.index];
    if (textureDef.sampler === void 0) return;
    const samplerDef = this.jsonDoc.json.samplers[textureDef.sampler];
    if (samplerDef.magFilter !== void 0) {
      textureInfo.setMagFilter(samplerDef.magFilter);
    }
    if (samplerDef.minFilter !== void 0) {
      textureInfo.setMinFilter(samplerDef.minFilter);
    }
    if (samplerDef.wrapS !== void 0) {
      textureInfo.setWrapS(samplerDef.wrapS);
    }
    if (samplerDef.wrapT !== void 0) {
      textureInfo.setWrapT(samplerDef.wrapT);
    }
  }
}
const DEFAULT_OPTIONS = {
  logger: Logger.DEFAULT_INSTANCE,
  extensions: [],
  dependencies: {}
};
const SUPPORTED_PREREAD_TYPES = /* @__PURE__ */ new Set([PropertyType.BUFFER, PropertyType.TEXTURE, PropertyType.MATERIAL, PropertyType.MESH, PropertyType.PRIMITIVE, PropertyType.NODE, PropertyType.SCENE]);
class GLTFReader {
  static read(jsonDoc, _options = DEFAULT_OPTIONS) {
    const options = _extends({}, DEFAULT_OPTIONS, _options);
    const {
      json
    } = jsonDoc;
    const document = new Document().setLogger(options.logger);
    this.validate(jsonDoc, options);
    const context = new ReaderContext(jsonDoc);
    const assetDef = json.asset;
    const asset = document.getRoot().getAsset();
    if (assetDef.copyright) asset.copyright = assetDef.copyright;
    if (assetDef.extras) asset.extras = assetDef.extras;
    if (json.extras !== void 0) {
      document.getRoot().setExtras(_extends({}, json.extras));
    }
    const extensionsUsed = json.extensionsUsed || [];
    const extensionsRequired = json.extensionsRequired || [];
    options.extensions.sort((a, b) => a.EXTENSION_NAME > b.EXTENSION_NAME ? 1 : -1);
    for (const Extension of options.extensions) {
      if (extensionsUsed.includes(Extension.EXTENSION_NAME)) {
        const extension = document.createExtension(Extension).setRequired(extensionsRequired.includes(Extension.EXTENSION_NAME));
        const unsupportedHooks = extension.prereadTypes.filter((type) => !SUPPORTED_PREREAD_TYPES.has(type));
        if (unsupportedHooks.length) {
          options.logger.warn(`Preread hooks for some types (${unsupportedHooks.join()}), requested by extension ${extension.extensionName}, are unsupported. Please file an issue or a PR.`);
        }
        for (const key of extension.readDependencies) {
          extension.install(key, options.dependencies[key]);
        }
      }
    }
    const bufferDefs = json.buffers || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.BUFFER)).forEach((extension) => extension.preread(context, PropertyType.BUFFER));
    context.buffers = bufferDefs.map((bufferDef) => {
      const buffer = document.createBuffer(bufferDef.name);
      if (bufferDef.extras) buffer.setExtras(bufferDef.extras);
      if (bufferDef.uri && bufferDef.uri.indexOf("__") !== 0) {
        buffer.setURI(bufferDef.uri);
      }
      return buffer;
    });
    const bufferViewDefs = json.bufferViews || [];
    context.bufferViewBuffers = bufferViewDefs.map((bufferViewDef, index) => {
      if (!context.bufferViews[index]) {
        const bufferDef = jsonDoc.json.buffers[bufferViewDef.buffer];
        const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
        const byteOffset = bufferViewDef.byteOffset || 0;
        context.bufferViews[index] = BufferUtils.toView(bufferData, byteOffset, bufferViewDef.byteLength);
      }
      return context.buffers[bufferViewDef.buffer];
    });
    const accessorDefs = json.accessors || [];
    context.accessors = accessorDefs.map((accessorDef) => {
      const buffer = context.bufferViewBuffers[accessorDef.bufferView];
      const accessor = document.createAccessor(accessorDef.name, buffer).setType(accessorDef.type);
      if (accessorDef.extras) accessor.setExtras(accessorDef.extras);
      if (accessorDef.normalized !== void 0) {
        accessor.setNormalized(accessorDef.normalized);
      }
      if (accessorDef.bufferView === void 0) return accessor;
      accessor.setArray(getAccessorArray(accessorDef, context));
      return accessor;
    });
    const imageDefs = json.images || [];
    const textureDefs = json.textures || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.TEXTURE)).forEach((extension) => extension.preread(context, PropertyType.TEXTURE));
    context.textures = imageDefs.map((imageDef) => {
      const texture = document.createTexture(imageDef.name);
      if (imageDef.extras) texture.setExtras(imageDef.extras);
      if (imageDef.bufferView !== void 0) {
        const bufferViewDef = json.bufferViews[imageDef.bufferView];
        const bufferDef = jsonDoc.json.buffers[bufferViewDef.buffer];
        const bufferData = bufferDef.uri ? jsonDoc.resources[bufferDef.uri] : jsonDoc.resources[GLB_BUFFER];
        const byteOffset = bufferViewDef.byteOffset || 0;
        const byteLength = bufferViewDef.byteLength;
        const imageData = bufferData.slice(byteOffset, byteOffset + byteLength);
        texture.setImage(imageData);
      } else if (imageDef.uri !== void 0) {
        texture.setImage(jsonDoc.resources[imageDef.uri]);
        if (imageDef.uri.indexOf("__") !== 0) {
          texture.setURI(imageDef.uri);
        }
      }
      if (imageDef.mimeType !== void 0) {
        texture.setMimeType(imageDef.mimeType);
      } else if (imageDef.uri) {
        const extension = FileUtils.extension(imageDef.uri);
        texture.setMimeType(ImageUtils.extensionToMimeType(extension));
      }
      return texture;
    });
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.MATERIAL)).forEach((extension) => extension.preread(context, PropertyType.MATERIAL));
    const materialDefs = json.materials || [];
    context.materials = materialDefs.map((materialDef) => {
      const material = document.createMaterial(materialDef.name);
      if (materialDef.extras) material.setExtras(materialDef.extras);
      if (materialDef.alphaMode !== void 0) {
        material.setAlphaMode(materialDef.alphaMode);
      }
      if (materialDef.alphaCutoff !== void 0) {
        material.setAlphaCutoff(materialDef.alphaCutoff);
      }
      if (materialDef.doubleSided !== void 0) {
        material.setDoubleSided(materialDef.doubleSided);
      }
      const pbrDef = materialDef.pbrMetallicRoughness || {};
      if (pbrDef.baseColorFactor !== void 0) {
        material.setBaseColorFactor(pbrDef.baseColorFactor);
      }
      if (materialDef.emissiveFactor !== void 0) {
        material.setEmissiveFactor(materialDef.emissiveFactor);
      }
      if (pbrDef.metallicFactor !== void 0) {
        material.setMetallicFactor(pbrDef.metallicFactor);
      }
      if (pbrDef.roughnessFactor !== void 0) {
        material.setRoughnessFactor(pbrDef.roughnessFactor);
      }
      if (pbrDef.baseColorTexture !== void 0) {
        const textureInfoDef = pbrDef.baseColorTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setBaseColorTexture(texture);
        context.setTextureInfo(material.getBaseColorTextureInfo(), textureInfoDef);
      }
      if (materialDef.emissiveTexture !== void 0) {
        const textureInfoDef = materialDef.emissiveTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setEmissiveTexture(texture);
        context.setTextureInfo(material.getEmissiveTextureInfo(), textureInfoDef);
      }
      if (materialDef.normalTexture !== void 0) {
        const textureInfoDef = materialDef.normalTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setNormalTexture(texture);
        context.setTextureInfo(material.getNormalTextureInfo(), textureInfoDef);
        if (materialDef.normalTexture.scale !== void 0) {
          material.setNormalScale(materialDef.normalTexture.scale);
        }
      }
      if (materialDef.occlusionTexture !== void 0) {
        const textureInfoDef = materialDef.occlusionTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setOcclusionTexture(texture);
        context.setTextureInfo(material.getOcclusionTextureInfo(), textureInfoDef);
        if (materialDef.occlusionTexture.strength !== void 0) {
          material.setOcclusionStrength(materialDef.occlusionTexture.strength);
        }
      }
      if (pbrDef.metallicRoughnessTexture !== void 0) {
        const textureInfoDef = pbrDef.metallicRoughnessTexture;
        const texture = context.textures[textureDefs[textureInfoDef.index].source];
        material.setMetallicRoughnessTexture(texture);
        context.setTextureInfo(material.getMetallicRoughnessTextureInfo(), textureInfoDef);
      }
      return material;
    });
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.MESH)).forEach((extension) => extension.preread(context, PropertyType.MESH));
    const meshDefs = json.meshes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.PRIMITIVE)).forEach((extension) => extension.preread(context, PropertyType.PRIMITIVE));
    context.meshes = meshDefs.map((meshDef) => {
      const mesh = document.createMesh(meshDef.name);
      if (meshDef.extras) mesh.setExtras(meshDef.extras);
      if (meshDef.weights !== void 0) {
        mesh.setWeights(meshDef.weights);
      }
      const primitiveDefs = meshDef.primitives || [];
      primitiveDefs.forEach((primitiveDef) => {
        const primitive = document.createPrimitive();
        if (primitiveDef.extras) primitive.setExtras(primitiveDef.extras);
        if (primitiveDef.material !== void 0) {
          primitive.setMaterial(context.materials[primitiveDef.material]);
        }
        if (primitiveDef.mode !== void 0) {
          primitive.setMode(primitiveDef.mode);
        }
        for (const [semantic, index] of Object.entries(primitiveDef.attributes || {})) {
          primitive.setAttribute(semantic, context.accessors[index]);
        }
        if (primitiveDef.indices !== void 0) {
          primitive.setIndices(context.accessors[primitiveDef.indices]);
        }
        const targetNames = meshDef.extras && meshDef.extras.targetNames || [];
        const targetDefs = primitiveDef.targets || [];
        targetDefs.forEach((targetDef, targetIndex) => {
          const targetName = targetNames[targetIndex] || targetIndex.toString();
          const target = document.createPrimitiveTarget(targetName);
          for (const [semantic, accessorIndex] of Object.entries(targetDef)) {
            target.setAttribute(semantic, context.accessors[accessorIndex]);
          }
          primitive.addTarget(target);
        });
        mesh.addPrimitive(primitive);
      });
      return mesh;
    });
    const cameraDefs = json.cameras || [];
    context.cameras = cameraDefs.map((cameraDef) => {
      const camera = document.createCamera(cameraDef.name).setType(cameraDef.type);
      if (cameraDef.extras) camera.setExtras(cameraDef.extras);
      if (cameraDef.type === Camera.Type.PERSPECTIVE) {
        const perspectiveDef = cameraDef.perspective;
        camera.setYFov(perspectiveDef.yfov);
        camera.setZNear(perspectiveDef.znear);
        if (perspectiveDef.zfar !== void 0) {
          camera.setZFar(perspectiveDef.zfar);
        }
        if (perspectiveDef.aspectRatio !== void 0) {
          camera.setAspectRatio(perspectiveDef.aspectRatio);
        }
      } else {
        const orthoDef = cameraDef.orthographic;
        camera.setZNear(orthoDef.znear).setZFar(orthoDef.zfar).setXMag(orthoDef.xmag).setYMag(orthoDef.ymag);
      }
      return camera;
    });
    const nodeDefs = json.nodes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.NODE)).forEach((extension) => extension.preread(context, PropertyType.NODE));
    context.nodes = nodeDefs.map((nodeDef) => {
      const node = document.createNode(nodeDef.name);
      if (nodeDef.extras) node.setExtras(nodeDef.extras);
      if (nodeDef.translation !== void 0) {
        node.setTranslation(nodeDef.translation);
      }
      if (nodeDef.rotation !== void 0) {
        node.setRotation(nodeDef.rotation);
      }
      if (nodeDef.scale !== void 0) {
        node.setScale(nodeDef.scale);
      }
      if (nodeDef.matrix !== void 0) {
        const translation = [0, 0, 0];
        const rotation = [0, 0, 0, 1];
        const scale = [1, 1, 1];
        MathUtils.decompose(nodeDef.matrix, translation, rotation, scale);
        node.setTranslation(translation);
        node.setRotation(rotation);
        node.setScale(scale);
      }
      if (nodeDef.weights !== void 0) {
        node.setWeights(nodeDef.weights);
      }
      return node;
    });
    const skinDefs = json.skins || [];
    context.skins = skinDefs.map((skinDef) => {
      const skin = document.createSkin(skinDef.name);
      if (skinDef.extras) skin.setExtras(skinDef.extras);
      if (skinDef.inverseBindMatrices !== void 0) {
        skin.setInverseBindMatrices(context.accessors[skinDef.inverseBindMatrices]);
      }
      if (skinDef.skeleton !== void 0) {
        skin.setSkeleton(context.nodes[skinDef.skeleton]);
      }
      for (const nodeIndex of skinDef.joints) {
        skin.addJoint(context.nodes[nodeIndex]);
      }
      return skin;
    });
    nodeDefs.map((nodeDef, nodeIndex) => {
      const node = context.nodes[nodeIndex];
      const children = nodeDef.children || [];
      children.forEach((childIndex) => node.addChild(context.nodes[childIndex]));
      if (nodeDef.mesh !== void 0) node.setMesh(context.meshes[nodeDef.mesh]);
      if (nodeDef.camera !== void 0) node.setCamera(context.cameras[nodeDef.camera]);
      if (nodeDef.skin !== void 0) node.setSkin(context.skins[nodeDef.skin]);
    });
    const animationDefs = json.animations || [];
    context.animations = animationDefs.map((animationDef) => {
      const animation = document.createAnimation(animationDef.name);
      if (animationDef.extras) animation.setExtras(animationDef.extras);
      const samplerDefs = animationDef.samplers || [];
      const samplers = samplerDefs.map((samplerDef) => {
        const sampler = document.createAnimationSampler().setInput(context.accessors[samplerDef.input]).setOutput(context.accessors[samplerDef.output]).setInterpolation(samplerDef.interpolation || AnimationSampler.Interpolation.LINEAR);
        if (samplerDef.extras) sampler.setExtras(samplerDef.extras);
        animation.addSampler(sampler);
        return sampler;
      });
      const channels = animationDef.channels || [];
      channels.forEach((channelDef) => {
        const channel = document.createAnimationChannel().setSampler(samplers[channelDef.sampler]).setTargetPath(channelDef.target.path);
        if (channelDef.target.node !== void 0) channel.setTargetNode(context.nodes[channelDef.target.node]);
        if (channelDef.extras) channel.setExtras(channelDef.extras);
        animation.addChannel(channel);
      });
      return animation;
    });
    const sceneDefs = json.scenes || [];
    document.getRoot().listExtensionsUsed().filter((extension) => extension.prereadTypes.includes(PropertyType.SCENE)).forEach((extension) => extension.preread(context, PropertyType.SCENE));
    context.scenes = sceneDefs.map((sceneDef) => {
      const scene = document.createScene(sceneDef.name);
      if (sceneDef.extras) scene.setExtras(sceneDef.extras);
      const children = sceneDef.nodes || [];
      children.map((nodeIndex) => context.nodes[nodeIndex]).forEach((node) => scene.addChild(node));
      return scene;
    });
    if (json.scene !== void 0) {
      document.getRoot().setDefaultScene(context.scenes[json.scene]);
    }
    document.getRoot().listExtensionsUsed().forEach((extension) => extension.read(context));
    accessorDefs.forEach((accessorDef, index) => {
      const accessor = context.accessors[index];
      const hasSparseValues = !!accessorDef.sparse;
      const isZeroFilled = !accessorDef.bufferView && !accessor.getArray();
      if (hasSparseValues || isZeroFilled) {
        accessor.setSparse(true).setArray(getSparseArray(accessorDef, context));
      }
    });
    return document;
  }
  static validate(jsonDoc, options) {
    const json = jsonDoc.json;
    if (json.asset.version !== "2.0") {
      throw new Error(`Unsupported glTF version, "${json.asset.version}".`);
    }
    if (json.extensionsRequired) {
      for (const extensionName of json.extensionsRequired) {
        if (!options.extensions.find((extension) => extension.EXTENSION_NAME === extensionName)) {
          throw new Error(`Missing required extension, "${extensionName}".`);
        }
      }
    }
    if (json.extensionsUsed) {
      for (const extensionName of json.extensionsUsed) {
        if (!options.extensions.find((extension) => extension.EXTENSION_NAME === extensionName)) {
          options.logger.warn(`Missing optional extension, "${extensionName}".`);
        }
      }
    }
  }
}
function getInterleavedArray(accessorDef, context) {
  const jsonDoc = context.jsonDoc;
  const bufferView = context.bufferViews[accessorDef.bufferView];
  const bufferViewDef = jsonDoc.json.bufferViews[accessorDef.bufferView];
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  const componentSize = TypedArray.BYTES_PER_ELEMENT;
  const accessorByteOffset = accessorDef.byteOffset || 0;
  const array = new TypedArray(accessorDef.count * elementSize);
  const view = new DataView(bufferView.buffer, bufferView.byteOffset, bufferView.byteLength);
  const byteStride = bufferViewDef.byteStride;
  for (let i = 0; i < accessorDef.count; i++) {
    for (let j = 0; j < elementSize; j++) {
      const byteOffset = accessorByteOffset + i * byteStride + j * componentSize;
      let value;
      switch (accessorDef.componentType) {
        case Accessor.ComponentType.FLOAT:
          value = view.getFloat32(byteOffset, true);
          break;
        case Accessor.ComponentType.UNSIGNED_INT:
          value = view.getUint32(byteOffset, true);
          break;
        case Accessor.ComponentType.UNSIGNED_SHORT:
          value = view.getUint16(byteOffset, true);
          break;
        case Accessor.ComponentType.UNSIGNED_BYTE:
          value = view.getUint8(byteOffset);
          break;
        case Accessor.ComponentType.SHORT:
          value = view.getInt16(byteOffset, true);
          break;
        case Accessor.ComponentType.BYTE:
          value = view.getInt8(byteOffset);
          break;
        default:
          throw new Error(`Unexpected componentType "${accessorDef.componentType}".`);
      }
      array[i * elementSize + j] = value;
    }
  }
  return array;
}
function getAccessorArray(accessorDef, context) {
  const jsonDoc = context.jsonDoc;
  const bufferView = context.bufferViews[accessorDef.bufferView];
  const bufferViewDef = jsonDoc.json.bufferViews[accessorDef.bufferView];
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  const componentSize = TypedArray.BYTES_PER_ELEMENT;
  const elementStride = elementSize * componentSize;
  if (bufferViewDef.byteStride !== void 0 && bufferViewDef.byteStride !== elementStride) {
    return getInterleavedArray(accessorDef, context);
  }
  const byteOffset = bufferView.byteOffset + (accessorDef.byteOffset || 0);
  const byteLength = accessorDef.count * elementSize * componentSize;
  return new TypedArray(bufferView.buffer.slice(byteOffset, byteOffset + byteLength));
}
function getSparseArray(accessorDef, context) {
  const TypedArray = ComponentTypeToTypedArray[accessorDef.componentType];
  const elementSize = Accessor.getElementSize(accessorDef.type);
  let array;
  if (accessorDef.bufferView !== void 0) {
    array = getAccessorArray(accessorDef, context);
  } else {
    array = new TypedArray(accessorDef.count * elementSize);
  }
  const sparseDef = accessorDef.sparse;
  if (!sparseDef) return array;
  const count = sparseDef.count;
  const indicesDef = _extends({}, accessorDef, sparseDef.indices, {
    count,
    type: "SCALAR"
  });
  const valuesDef = _extends({}, accessorDef, sparseDef.values, {
    count
  });
  const indices = getAccessorArray(indicesDef, context);
  const values = getAccessorArray(valuesDef, context);
  for (let i = 0; i < indicesDef.count; i++) {
    for (let j = 0; j < elementSize; j++) {
      array[indices[i] * elementSize + j] = values[i * elementSize + j];
    }
  }
  return array;
}
var BufferViewTarget;
(function(BufferViewTarget2) {
  BufferViewTarget2[BufferViewTarget2["ARRAY_BUFFER"] = 34962] = "ARRAY_BUFFER";
  BufferViewTarget2[BufferViewTarget2["ELEMENT_ARRAY_BUFFER"] = 34963] = "ELEMENT_ARRAY_BUFFER";
})(BufferViewTarget || (BufferViewTarget = {}));
class WriterContext {
  constructor(_doc, jsonDoc, options) {
    this._doc = void 0;
    this.jsonDoc = void 0;
    this.options = void 0;
    this.accessorIndexMap = /* @__PURE__ */ new Map();
    this.animationIndexMap = /* @__PURE__ */ new Map();
    this.bufferIndexMap = /* @__PURE__ */ new Map();
    this.cameraIndexMap = /* @__PURE__ */ new Map();
    this.skinIndexMap = /* @__PURE__ */ new Map();
    this.materialIndexMap = /* @__PURE__ */ new Map();
    this.meshIndexMap = /* @__PURE__ */ new Map();
    this.nodeIndexMap = /* @__PURE__ */ new Map();
    this.imageIndexMap = /* @__PURE__ */ new Map();
    this.textureDefIndexMap = /* @__PURE__ */ new Map();
    this.textureInfoDefMap = /* @__PURE__ */ new Map();
    this.samplerDefIndexMap = /* @__PURE__ */ new Map();
    this.sceneIndexMap = /* @__PURE__ */ new Map();
    this.imageBufferViews = [];
    this.otherBufferViews = /* @__PURE__ */ new Map();
    this.otherBufferViewsIndexMap = /* @__PURE__ */ new Map();
    this.extensionData = {};
    this.bufferURIGenerator = void 0;
    this.imageURIGenerator = void 0;
    this.logger = void 0;
    this._accessorUsageMap = /* @__PURE__ */ new Map();
    this.accessorUsageGroupedByParent = /* @__PURE__ */ new Set(["ARRAY_BUFFER"]);
    this.accessorParents = /* @__PURE__ */ new Map();
    this._doc = _doc;
    this.jsonDoc = jsonDoc;
    this.options = options;
    const root = _doc.getRoot();
    const numBuffers = root.listBuffers().length;
    const numImages = root.listTextures().length;
    this.bufferURIGenerator = new UniqueURIGenerator(numBuffers > 1, () => options.basename || "buffer");
    this.imageURIGenerator = new UniqueURIGenerator(numImages > 1, (texture) => getSlot(_doc, texture) || options.basename || "texture");
    this.logger = _doc.getLogger();
  }
  /**
   * Creates a TextureInfo definition, and any Texture or Sampler definitions it requires. If
   * possible, Texture and Sampler definitions are shared.
   */
  createTextureInfoDef(texture, textureInfo) {
    const samplerDef = {
      magFilter: textureInfo.getMagFilter() || void 0,
      minFilter: textureInfo.getMinFilter() || void 0,
      wrapS: textureInfo.getWrapS(),
      wrapT: textureInfo.getWrapT()
    };
    const samplerKey = JSON.stringify(samplerDef);
    if (!this.samplerDefIndexMap.has(samplerKey)) {
      this.samplerDefIndexMap.set(samplerKey, this.jsonDoc.json.samplers.length);
      this.jsonDoc.json.samplers.push(samplerDef);
    }
    const textureDef = {
      source: this.imageIndexMap.get(texture),
      sampler: this.samplerDefIndexMap.get(samplerKey)
    };
    const textureKey = JSON.stringify(textureDef);
    if (!this.textureDefIndexMap.has(textureKey)) {
      this.textureDefIndexMap.set(textureKey, this.jsonDoc.json.textures.length);
      this.jsonDoc.json.textures.push(textureDef);
    }
    const textureInfoDef = {
      index: this.textureDefIndexMap.get(textureKey)
    };
    if (textureInfo.getTexCoord() !== 0) {
      textureInfoDef.texCoord = textureInfo.getTexCoord();
    }
    if (Object.keys(textureInfo.getExtras()).length > 0) {
      textureInfoDef.extras = textureInfo.getExtras();
    }
    this.textureInfoDefMap.set(textureInfo, textureInfoDef);
    return textureInfoDef;
  }
  createPropertyDef(property) {
    const def = {};
    if (property.getName()) {
      def.name = property.getName();
    }
    if (Object.keys(property.getExtras()).length > 0) {
      def.extras = property.getExtras();
    }
    return def;
  }
  createAccessorDef(accessor) {
    const accessorDef = this.createPropertyDef(accessor);
    accessorDef.type = accessor.getType();
    accessorDef.componentType = accessor.getComponentType();
    accessorDef.count = accessor.getCount();
    const needsBounds = this._doc.getGraph().listParentEdges(accessor).some((edge) => edge.getName() === "attributes" && edge.getAttributes().key === "POSITION" || edge.getName() === "input");
    if (needsBounds) {
      accessorDef.max = accessor.getMax([]).map(Math.fround);
      accessorDef.min = accessor.getMin([]).map(Math.fround);
    }
    if (accessor.getNormalized()) {
      accessorDef.normalized = accessor.getNormalized();
    }
    return accessorDef;
  }
  createImageData(imageDef, data, texture) {
    if (this.options.format === Format.GLB) {
      this.imageBufferViews.push(data);
      imageDef.bufferView = this.jsonDoc.json.bufferViews.length;
      this.jsonDoc.json.bufferViews.push({
        buffer: 0,
        byteOffset: -1,
        // determined while iterating buffers, in Writer.ts.
        byteLength: data.byteLength
      });
    } else {
      const extension = ImageUtils.mimeTypeToExtension(texture.getMimeType());
      imageDef.uri = this.imageURIGenerator.createURI(texture, extension);
      this.assignResourceURI(imageDef.uri, data, false);
    }
  }
  assignResourceURI(uri, data, throwOnConflict) {
    const resources = this.jsonDoc.resources;
    if (!(uri in resources)) {
      resources[uri] = data;
      return;
    }
    if (data === resources[uri]) {
      this.logger.warn(`Duplicate resource URI, "${uri}".`);
      return;
    }
    const conflictMessage = `Resource URI "${uri}" already assigned to different data.`;
    if (!throwOnConflict) {
      this.logger.warn(conflictMessage);
      return;
    }
    throw new Error(conflictMessage);
  }
  /**
   * Returns implicit usage type of the given accessor, related to grouping accessors into
   * buffer views. Usage is a superset of buffer view target, including ARRAY_BUFFER and
   * ELEMENT_ARRAY_BUFFER, but also usages that do not match GPU buffer view targets such as
   * IBMs. Additional usages are defined by extensions, like `EXT_mesh_gpu_instancing`.
   */
  getAccessorUsage(accessor) {
    const cachedUsage = this._accessorUsageMap.get(accessor);
    if (cachedUsage) return cachedUsage;
    if (accessor.getSparse()) return BufferViewUsage$1.SPARSE;
    for (const edge of this._doc.getGraph().listParentEdges(accessor)) {
      const {
        usage
      } = edge.getAttributes();
      if (usage) return usage;
      if (edge.getParent().propertyType !== PropertyType.ROOT) {
        this.logger.warn(`Missing attribute ".usage" on edge, "${edge.getName()}".`);
      }
    }
    return BufferViewUsage$1.OTHER;
  }
  /**
   * Sets usage for the given accessor. Some accessor types must be grouped into
   * buffer views with like accessors. This includes the specified buffer view "targets", but
   * also implicit usage like IBMs or instanced mesh attributes. If unspecified, an accessor
   * will be grouped with other accessors of unspecified usage.
   */
  addAccessorToUsageGroup(accessor, usage) {
    const prevUsage = this._accessorUsageMap.get(accessor);
    if (prevUsage && prevUsage !== usage) {
      throw new Error(`Accessor with usage "${prevUsage}" cannot be reused as "${usage}".`);
    }
    this._accessorUsageMap.set(accessor, usage);
    return this;
  }
}
WriterContext.BufferViewTarget = BufferViewTarget;
WriterContext.BufferViewUsage = BufferViewUsage$1;
WriterContext.USAGE_TO_TARGET = {
  [BufferViewUsage$1.ARRAY_BUFFER]: BufferViewTarget.ARRAY_BUFFER,
  [BufferViewUsage$1.ELEMENT_ARRAY_BUFFER]: BufferViewTarget.ELEMENT_ARRAY_BUFFER
};
class UniqueURIGenerator {
  constructor(multiple, basename) {
    this.multiple = void 0;
    this.basename = void 0;
    this.counter = {};
    this.multiple = multiple;
    this.basename = basename;
  }
  createURI(object, extension) {
    if (object.getURI()) {
      return object.getURI();
    } else if (!this.multiple) {
      return `${this.basename(object)}.${extension}`;
    } else {
      const basename = this.basename(object);
      this.counter[basename] = this.counter[basename] || 1;
      return `${basename}_${this.counter[basename]++}.${extension}`;
    }
  }
}
function getSlot(document, texture) {
  const edge = document.getGraph().listParentEdges(texture).find((edge2) => edge2.getParent() !== document.getRoot());
  return edge ? edge.getName().replace(/texture$/i, "") : "";
}
const {
  BufferViewUsage
} = WriterContext;
const {
  UNSIGNED_INT,
  UNSIGNED_SHORT,
  UNSIGNED_BYTE
} = Accessor.ComponentType;
const SUPPORTED_PREWRITE_TYPES = /* @__PURE__ */ new Set([PropertyType.ACCESSOR, PropertyType.BUFFER, PropertyType.MATERIAL, PropertyType.MESH]);
class GLTFWriter {
  static write(doc, options) {
    const graph = doc.getGraph();
    const root = doc.getRoot();
    const json = {
      asset: _extends({
        generator: `glTF-Transform ${VERSION}`
      }, root.getAsset()),
      extras: _extends({}, root.getExtras())
    };
    const jsonDoc = {
      json,
      resources: {}
    };
    const context = new WriterContext(doc, jsonDoc, options);
    const logger = options.logger || Logger.DEFAULT_INSTANCE;
    const extensionsRegistered = new Set(options.extensions.map((ext) => ext.EXTENSION_NAME));
    const extensionsUsed = doc.getRoot().listExtensionsUsed().filter((ext) => extensionsRegistered.has(ext.extensionName)).sort((a, b) => a.extensionName > b.extensionName ? 1 : -1);
    const extensionsRequired = doc.getRoot().listExtensionsRequired().filter((ext) => extensionsRegistered.has(ext.extensionName)).sort((a, b) => a.extensionName > b.extensionName ? 1 : -1);
    if (extensionsUsed.length < doc.getRoot().listExtensionsUsed().length) {
      logger.warn("Some extensions were not registered for I/O, and will not be written.");
    }
    for (const extension of extensionsUsed) {
      const unsupportedHooks = extension.prewriteTypes.filter((type) => !SUPPORTED_PREWRITE_TYPES.has(type));
      if (unsupportedHooks.length) {
        logger.warn(`Prewrite hooks for some types (${unsupportedHooks.join()}), requested by extension ${extension.extensionName}, are unsupported. Please file an issue or a PR.`);
      }
      for (const key of extension.writeDependencies) {
        extension.install(key, options.dependencies[key]);
      }
    }
    function concatAccessors(accessors, bufferIndex, bufferByteOffset, bufferViewTarget) {
      const buffers = [];
      let byteLength = 0;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        accessorDef.bufferView = json.bufferViews.length;
        const accessorArray = accessor.getArray();
        const data = BufferUtils.pad(BufferUtils.toView(accessorArray));
        accessorDef.byteOffset = byteLength;
        byteLength += data.byteLength;
        buffers.push(data);
        context.accessorIndexMap.set(accessor, json.accessors.length);
        json.accessors.push(accessorDef);
      }
      const bufferViewData = BufferUtils.concat(buffers);
      const bufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset,
        byteLength: bufferViewData.byteLength
      };
      if (bufferViewTarget) bufferViewDef.target = bufferViewTarget;
      json.bufferViews.push(bufferViewDef);
      return {
        buffers,
        byteLength
      };
    }
    function interleaveAccessors(accessors, bufferIndex, bufferByteOffset) {
      const vertexCount = accessors[0].getCount();
      let byteStride = 0;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        accessorDef.bufferView = json.bufferViews.length;
        accessorDef.byteOffset = byteStride;
        const elementSize = accessor.getElementSize();
        const componentSize = accessor.getComponentSize();
        byteStride += BufferUtils.padNumber(elementSize * componentSize);
        context.accessorIndexMap.set(accessor, json.accessors.length);
        json.accessors.push(accessorDef);
      }
      const byteLength = vertexCount * byteStride;
      const buffer = new ArrayBuffer(byteLength);
      const view = new DataView(buffer);
      for (let i = 0; i < vertexCount; i++) {
        let vertexByteOffset = 0;
        for (const accessor of accessors) {
          const elementSize = accessor.getElementSize();
          const componentSize = accessor.getComponentSize();
          const componentType = accessor.getComponentType();
          const array = accessor.getArray();
          for (let j = 0; j < elementSize; j++) {
            const viewByteOffset = i * byteStride + vertexByteOffset + j * componentSize;
            const value = array[i * elementSize + j];
            switch (componentType) {
              case Accessor.ComponentType.FLOAT:
                view.setFloat32(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.BYTE:
                view.setInt8(viewByteOffset, value);
                break;
              case Accessor.ComponentType.SHORT:
                view.setInt16(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.UNSIGNED_BYTE:
                view.setUint8(viewByteOffset, value);
                break;
              case Accessor.ComponentType.UNSIGNED_SHORT:
                view.setUint16(viewByteOffset, value, true);
                break;
              case Accessor.ComponentType.UNSIGNED_INT:
                view.setUint32(viewByteOffset, value, true);
                break;
              default:
                throw new Error("Unexpected component type: " + componentType);
            }
          }
          vertexByteOffset += BufferUtils.padNumber(elementSize * componentSize);
        }
      }
      const bufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset,
        byteLength,
        byteStride,
        target: WriterContext.BufferViewTarget.ARRAY_BUFFER
      };
      json.bufferViews.push(bufferViewDef);
      return {
        byteLength,
        buffers: [new Uint8Array(buffer)]
      };
    }
    function concatSparseAccessors(accessors, bufferIndex, bufferByteOffset) {
      const buffers = [];
      let byteLength = 0;
      const sparseData = /* @__PURE__ */ new Map();
      let maxIndex = -Infinity;
      let needSparseWarning = false;
      for (const accessor of accessors) {
        const accessorDef = context.createAccessorDef(accessor);
        json.accessors.push(accessorDef);
        context.accessorIndexMap.set(accessor, json.accessors.length - 1);
        const indices = [];
        const values = [];
        const el = [];
        const base = new Array(accessor.getElementSize()).fill(0);
        for (let i = 0, il = accessor.getCount(); i < il; i++) {
          accessor.getElement(i, el);
          if (MathUtils.eq(el, base, 0)) continue;
          maxIndex = Math.max(i, maxIndex);
          indices.push(i);
          for (let j = 0; j < el.length; j++) values.push(el[j]);
        }
        const count = indices.length;
        const data = {
          accessorDef,
          count
        };
        sparseData.set(accessor, data);
        if (count === 0) continue;
        if (count > accessor.getCount() / 2) {
          needSparseWarning = true;
        }
        const ValueArray = ComponentTypeToTypedArray[accessor.getComponentType()];
        data.indices = indices;
        data.values = new ValueArray(values);
      }
      if (!Number.isFinite(maxIndex)) {
        return {
          buffers,
          byteLength
        };
      }
      if (needSparseWarning) {
        logger.warn(`Some sparse accessors have >50% non-zero elements, which may increase file size.`);
      }
      const IndexArray = maxIndex < 255 ? Uint8Array : maxIndex < 65535 ? Uint16Array : Uint32Array;
      const IndexComponentType = maxIndex < 255 ? UNSIGNED_BYTE : maxIndex < 65535 ? UNSIGNED_SHORT : UNSIGNED_INT;
      const indicesBufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset + byteLength,
        byteLength: 0
      };
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.indicesByteOffset = indicesBufferViewDef.byteLength;
        const buffer = BufferUtils.pad(BufferUtils.toView(new IndexArray(data.indices)));
        buffers.push(buffer);
        byteLength += buffer.byteLength;
        indicesBufferViewDef.byteLength += buffer.byteLength;
      }
      json.bufferViews.push(indicesBufferViewDef);
      const indicesBufferViewIndex = json.bufferViews.length - 1;
      const valuesBufferViewDef = {
        buffer: bufferIndex,
        byteOffset: bufferByteOffset + byteLength,
        byteLength: 0
      };
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.valuesByteOffset = valuesBufferViewDef.byteLength;
        const buffer = BufferUtils.pad(BufferUtils.toView(data.values));
        buffers.push(buffer);
        byteLength += buffer.byteLength;
        valuesBufferViewDef.byteLength += buffer.byteLength;
      }
      json.bufferViews.push(valuesBufferViewDef);
      const valuesBufferViewIndex = json.bufferViews.length - 1;
      for (const accessor of accessors) {
        const data = sparseData.get(accessor);
        if (data.count === 0) continue;
        data.accessorDef.sparse = {
          count: data.count,
          indices: {
            bufferView: indicesBufferViewIndex,
            byteOffset: data.indicesByteOffset,
            componentType: IndexComponentType
          },
          values: {
            bufferView: valuesBufferViewIndex,
            byteOffset: data.valuesByteOffset
          }
        };
      }
      return {
        buffers,
        byteLength
      };
    }
    json.accessors = [];
    json.bufferViews = [];
    json.samplers = [];
    json.textures = [];
    json.images = root.listTextures().map((texture, textureIndex) => {
      const imageDef = context.createPropertyDef(texture);
      if (texture.getMimeType()) {
        imageDef.mimeType = texture.getMimeType();
      }
      const image = texture.getImage();
      if (image) {
        context.createImageData(imageDef, image, texture);
      }
      context.imageIndexMap.set(texture, textureIndex);
      return imageDef;
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes(PropertyType.ACCESSOR)).forEach((extension) => extension.prewrite(context, PropertyType.ACCESSOR));
    root.listAccessors().forEach((accessor) => {
      const groupByParent = context.accessorUsageGroupedByParent;
      const accessorParents = context.accessorParents;
      if (context.accessorIndexMap.has(accessor)) return;
      const usage = context.getAccessorUsage(accessor);
      context.addAccessorToUsageGroup(accessor, usage);
      if (groupByParent.has(usage)) {
        const parent = graph.listParents(accessor).find((parent2) => parent2.propertyType !== PropertyType.ROOT);
        accessorParents.set(accessor, parent);
      }
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes(PropertyType.BUFFER)).forEach((extension) => extension.prewrite(context, PropertyType.BUFFER));
    const needsBuffer = root.listAccessors().length > 0 || context.otherBufferViews.size > 0 || root.listTextures().length > 0 && options.format === Format.GLB;
    if (needsBuffer && root.listBuffers().length === 0) {
      throw new Error("Buffer required for Document resources, but none was found.");
    }
    json.buffers = [];
    root.listBuffers().forEach((buffer, index) => {
      const bufferDef = context.createPropertyDef(buffer);
      const groupByParent = context.accessorUsageGroupedByParent;
      const accessors = buffer.listParents().filter((property) => property instanceof Accessor);
      const uniqueParents = new Set(accessors.map((accessor) => context.accessorParents.get(accessor)));
      const parentToIndex = new Map(Array.from(uniqueParents).map((parent, index2) => [parent, index2]));
      const accessorGroups = {};
      for (const accessor of accessors) {
        var _key;
        if (context.accessorIndexMap.has(accessor)) continue;
        const usage = context.getAccessorUsage(accessor);
        let key = usage;
        if (groupByParent.has(usage)) {
          const parent = context.accessorParents.get(accessor);
          key += `:${parentToIndex.get(parent)}`;
        }
        accessorGroups[_key = key] || (accessorGroups[_key] = {
          usage,
          accessors: []
        });
        accessorGroups[key].accessors.push(accessor);
      }
      const buffers = [];
      const bufferIndex = json.buffers.length;
      let bufferByteLength = 0;
      for (const {
        usage,
        accessors: groupAccessors
      } of Object.values(accessorGroups)) {
        if (usage === BufferViewUsage.ARRAY_BUFFER && options.vertexLayout === VertexLayout.INTERLEAVED) {
          const result = interleaveAccessors(groupAccessors, bufferIndex, bufferByteLength);
          bufferByteLength += result.byteLength;
          for (const _buffer of result.buffers) {
            buffers.push(_buffer);
          }
        } else if (usage === BufferViewUsage.ARRAY_BUFFER) {
          for (const accessor of groupAccessors) {
            const result = interleaveAccessors([accessor], bufferIndex, bufferByteLength);
            bufferByteLength += result.byteLength;
            for (const _buffer2 of result.buffers) {
              buffers.push(_buffer2);
            }
          }
        } else if (usage === BufferViewUsage.SPARSE) {
          const result = concatSparseAccessors(groupAccessors, bufferIndex, bufferByteLength);
          bufferByteLength += result.byteLength;
          for (const _buffer3 of result.buffers) {
            buffers.push(_buffer3);
          }
        } else if (usage === BufferViewUsage.ELEMENT_ARRAY_BUFFER) {
          const target = WriterContext.BufferViewTarget.ELEMENT_ARRAY_BUFFER;
          const result = concatAccessors(groupAccessors, bufferIndex, bufferByteLength, target);
          bufferByteLength += result.byteLength;
          for (const _buffer4 of result.buffers) {
            buffers.push(_buffer4);
          }
        } else {
          const result = concatAccessors(groupAccessors, bufferIndex, bufferByteLength);
          bufferByteLength += result.byteLength;
          for (const _buffer5 of result.buffers) {
            buffers.push(_buffer5);
          }
        }
      }
      if (context.imageBufferViews.length && index === 0) {
        for (let i = 0; i < context.imageBufferViews.length; i++) {
          json.bufferViews[json.images[i].bufferView].byteOffset = bufferByteLength;
          bufferByteLength += context.imageBufferViews[i].byteLength;
          buffers.push(context.imageBufferViews[i]);
          if (bufferByteLength % 8) {
            const imagePadding = 8 - bufferByteLength % 8;
            bufferByteLength += imagePadding;
            buffers.push(new Uint8Array(imagePadding));
          }
        }
      }
      if (context.otherBufferViews.has(buffer)) {
        for (const data of context.otherBufferViews.get(buffer)) {
          json.bufferViews.push({
            buffer: bufferIndex,
            byteOffset: bufferByteLength,
            byteLength: data.byteLength
          });
          context.otherBufferViewsIndexMap.set(data, json.bufferViews.length - 1);
          bufferByteLength += data.byteLength;
          buffers.push(data);
        }
      }
      if (bufferByteLength) {
        let uri;
        if (options.format === Format.GLB) {
          uri = GLB_BUFFER;
        } else {
          uri = context.bufferURIGenerator.createURI(buffer, "bin");
          bufferDef.uri = uri;
        }
        bufferDef.byteLength = bufferByteLength;
        context.assignResourceURI(uri, BufferUtils.concat(buffers), true);
      }
      json.buffers.push(bufferDef);
      context.bufferIndexMap.set(buffer, index);
    });
    if (root.listAccessors().find((a) => !a.getBuffer())) {
      logger.warn("Skipped writing one or more Accessors: no Buffer assigned.");
    }
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes(PropertyType.MATERIAL)).forEach((extension) => extension.prewrite(context, PropertyType.MATERIAL));
    json.materials = root.listMaterials().map((material, index) => {
      const materialDef = context.createPropertyDef(material);
      if (material.getAlphaMode() !== Material.AlphaMode.OPAQUE) {
        materialDef.alphaMode = material.getAlphaMode();
      }
      if (material.getAlphaMode() === Material.AlphaMode.MASK) {
        materialDef.alphaCutoff = material.getAlphaCutoff();
      }
      if (material.getDoubleSided()) materialDef.doubleSided = true;
      materialDef.pbrMetallicRoughness = {};
      if (!MathUtils.eq(material.getBaseColorFactor(), [1, 1, 1, 1])) {
        materialDef.pbrMetallicRoughness.baseColorFactor = material.getBaseColorFactor();
      }
      if (!MathUtils.eq(material.getEmissiveFactor(), [0, 0, 0])) {
        materialDef.emissiveFactor = material.getEmissiveFactor();
      }
      if (material.getRoughnessFactor() !== 1) {
        materialDef.pbrMetallicRoughness.roughnessFactor = material.getRoughnessFactor();
      }
      if (material.getMetallicFactor() !== 1) {
        materialDef.pbrMetallicRoughness.metallicFactor = material.getMetallicFactor();
      }
      if (material.getBaseColorTexture()) {
        const texture = material.getBaseColorTexture();
        const textureInfo = material.getBaseColorTextureInfo();
        materialDef.pbrMetallicRoughness.baseColorTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      if (material.getEmissiveTexture()) {
        const texture = material.getEmissiveTexture();
        const textureInfo = material.getEmissiveTextureInfo();
        materialDef.emissiveTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      if (material.getNormalTexture()) {
        const texture = material.getNormalTexture();
        const textureInfo = material.getNormalTextureInfo();
        const textureInfoDef = context.createTextureInfoDef(texture, textureInfo);
        if (material.getNormalScale() !== 1) {
          textureInfoDef.scale = material.getNormalScale();
        }
        materialDef.normalTexture = textureInfoDef;
      }
      if (material.getOcclusionTexture()) {
        const texture = material.getOcclusionTexture();
        const textureInfo = material.getOcclusionTextureInfo();
        const textureInfoDef = context.createTextureInfoDef(texture, textureInfo);
        if (material.getOcclusionStrength() !== 1) {
          textureInfoDef.strength = material.getOcclusionStrength();
        }
        materialDef.occlusionTexture = textureInfoDef;
      }
      if (material.getMetallicRoughnessTexture()) {
        const texture = material.getMetallicRoughnessTexture();
        const textureInfo = material.getMetallicRoughnessTextureInfo();
        materialDef.pbrMetallicRoughness.metallicRoughnessTexture = context.createTextureInfoDef(texture, textureInfo);
      }
      context.materialIndexMap.set(material, index);
      return materialDef;
    });
    extensionsUsed.filter((extension) => extension.prewriteTypes.includes(PropertyType.MESH)).forEach((extension) => extension.prewrite(context, PropertyType.MESH));
    json.meshes = root.listMeshes().map((mesh, index) => {
      const meshDef = context.createPropertyDef(mesh);
      let targetNames = null;
      meshDef.primitives = mesh.listPrimitives().map((primitive) => {
        const primitiveDef = {
          attributes: {}
        };
        primitiveDef.mode = primitive.getMode();
        const material = primitive.getMaterial();
        if (material) {
          primitiveDef.material = context.materialIndexMap.get(material);
        }
        if (Object.keys(primitive.getExtras()).length) {
          primitiveDef.extras = primitive.getExtras();
        }
        const indices = primitive.getIndices();
        if (indices) {
          primitiveDef.indices = context.accessorIndexMap.get(indices);
        }
        for (const semantic of primitive.listSemantics()) {
          primitiveDef.attributes[semantic] = context.accessorIndexMap.get(primitive.getAttribute(semantic));
        }
        for (const target of primitive.listTargets()) {
          const targetDef = {};
          for (const semantic of target.listSemantics()) {
            targetDef[semantic] = context.accessorIndexMap.get(target.getAttribute(semantic));
          }
          primitiveDef.targets = primitiveDef.targets || [];
          primitiveDef.targets.push(targetDef);
        }
        if (primitive.listTargets().length && !targetNames) {
          targetNames = primitive.listTargets().map((target) => target.getName());
        }
        return primitiveDef;
      });
      if (mesh.getWeights().length) {
        meshDef.weights = mesh.getWeights();
      }
      if (targetNames) {
        meshDef.extras = meshDef.extras || {};
        meshDef.extras["targetNames"] = targetNames;
      }
      context.meshIndexMap.set(mesh, index);
      return meshDef;
    });
    json.cameras = root.listCameras().map((camera, index) => {
      const cameraDef = context.createPropertyDef(camera);
      cameraDef.type = camera.getType();
      if (cameraDef.type === Camera.Type.PERSPECTIVE) {
        cameraDef.perspective = {
          znear: camera.getZNear(),
          zfar: camera.getZFar(),
          yfov: camera.getYFov()
        };
        const aspectRatio = camera.getAspectRatio();
        if (aspectRatio !== null) {
          cameraDef.perspective.aspectRatio = aspectRatio;
        }
      } else {
        cameraDef.orthographic = {
          znear: camera.getZNear(),
          zfar: camera.getZFar(),
          xmag: camera.getXMag(),
          ymag: camera.getYMag()
        };
      }
      context.cameraIndexMap.set(camera, index);
      return cameraDef;
    });
    json.nodes = root.listNodes().map((node, index) => {
      const nodeDef = context.createPropertyDef(node);
      if (!MathUtils.eq(node.getTranslation(), [0, 0, 0])) {
        nodeDef.translation = node.getTranslation();
      }
      if (!MathUtils.eq(node.getRotation(), [0, 0, 0, 1])) {
        nodeDef.rotation = node.getRotation();
      }
      if (!MathUtils.eq(node.getScale(), [1, 1, 1])) {
        nodeDef.scale = node.getScale();
      }
      if (node.getWeights().length) {
        nodeDef.weights = node.getWeights();
      }
      context.nodeIndexMap.set(node, index);
      return nodeDef;
    });
    json.skins = root.listSkins().map((skin, index) => {
      const skinDef = context.createPropertyDef(skin);
      const inverseBindMatrices = skin.getInverseBindMatrices();
      if (inverseBindMatrices) {
        skinDef.inverseBindMatrices = context.accessorIndexMap.get(inverseBindMatrices);
      }
      const skeleton = skin.getSkeleton();
      if (skeleton) {
        skinDef.skeleton = context.nodeIndexMap.get(skeleton);
      }
      skinDef.joints = skin.listJoints().map((joint) => context.nodeIndexMap.get(joint));
      context.skinIndexMap.set(skin, index);
      return skinDef;
    });
    root.listNodes().forEach((node, index) => {
      const nodeDef = json.nodes[index];
      const mesh = node.getMesh();
      if (mesh) {
        nodeDef.mesh = context.meshIndexMap.get(mesh);
      }
      const camera = node.getCamera();
      if (camera) {
        nodeDef.camera = context.cameraIndexMap.get(camera);
      }
      const skin = node.getSkin();
      if (skin) {
        nodeDef.skin = context.skinIndexMap.get(skin);
      }
      if (node.listChildren().length > 0) {
        nodeDef.children = node.listChildren().map((node2) => context.nodeIndexMap.get(node2));
      }
    });
    json.animations = root.listAnimations().map((animation, index) => {
      const animationDef = context.createPropertyDef(animation);
      const samplerIndexMap = /* @__PURE__ */ new Map();
      animationDef.samplers = animation.listSamplers().map((sampler, samplerIndex) => {
        const samplerDef = context.createPropertyDef(sampler);
        samplerDef.input = context.accessorIndexMap.get(sampler.getInput());
        samplerDef.output = context.accessorIndexMap.get(sampler.getOutput());
        samplerDef.interpolation = sampler.getInterpolation();
        samplerIndexMap.set(sampler, samplerIndex);
        return samplerDef;
      });
      animationDef.channels = animation.listChannels().map((channel) => {
        const channelDef = context.createPropertyDef(channel);
        channelDef.sampler = samplerIndexMap.get(channel.getSampler());
        channelDef.target = {
          node: context.nodeIndexMap.get(channel.getTargetNode()),
          path: channel.getTargetPath()
        };
        return channelDef;
      });
      context.animationIndexMap.set(animation, index);
      return animationDef;
    });
    json.scenes = root.listScenes().map((scene, index) => {
      const sceneDef = context.createPropertyDef(scene);
      sceneDef.nodes = scene.listChildren().map((node) => context.nodeIndexMap.get(node));
      context.sceneIndexMap.set(scene, index);
      return sceneDef;
    });
    const defaultScene = root.getDefaultScene();
    if (defaultScene) {
      json.scene = root.listScenes().indexOf(defaultScene);
    }
    json.extensionsUsed = extensionsUsed.map((ext) => ext.extensionName);
    json.extensionsRequired = extensionsRequired.map((ext) => ext.extensionName);
    extensionsUsed.forEach((extension) => extension.write(context));
    clean(json);
    return jsonDoc;
  }
}
function clean(object) {
  const unused = [];
  for (const key in object) {
    const value = object[key];
    if (Array.isArray(value) && value.length === 0) {
      unused.push(key);
    } else if (value === null || value === "") {
      unused.push(key);
    } else if (value && typeof value === "object" && Object.keys(value).length === 0) {
      unused.push(key);
    }
  }
  for (const key of unused) {
    delete object[key];
  }
}
var ChunkType;
(function(ChunkType2) {
  ChunkType2[ChunkType2["JSON"] = 1313821514] = "JSON";
  ChunkType2[ChunkType2["BIN"] = 5130562] = "BIN";
})(ChunkType || (ChunkType = {}));
class PlatformIO {
  constructor() {
    this._logger = Logger.DEFAULT_INSTANCE;
    this._extensions = /* @__PURE__ */ new Set();
    this._dependencies = {};
    this._vertexLayout = VertexLayout.INTERLEAVED;
    this._strictResources = true;
    this.lastReadBytes = 0;
    this.lastWriteBytes = 0;
  }
  /** Sets the {@link Logger} used by this I/O instance. Defaults to Logger.DEFAULT_INSTANCE. */
  setLogger(logger) {
    this._logger = logger;
    return this;
  }
  /** Registers extensions, enabling I/O class to read and write glTF assets requiring them. */
  registerExtensions(extensions) {
    for (const extension of extensions) {
      this._extensions.add(extension);
      extension.register();
    }
    return this;
  }
  /** Registers dependencies used (e.g. by extensions) in the I/O process. */
  registerDependencies(dependencies) {
    Object.assign(this._dependencies, dependencies);
    return this;
  }
  /**
   * Sets the vertex layout method used by this I/O instance. Defaults to
   * VertexLayout.INTERLEAVED.
   */
  setVertexLayout(layout) {
    this._vertexLayout = layout;
    return this;
  }
  /**
   * Sets whether missing external resources should throw errors (strict mode) or
   * be ignored with warnings. Missing images can be ignored, but missing buffers
   * will currently always result in an error. When strict mode is disabled and
   * missing resources are encountered, the resulting {@link Document} will be
   * created in an invalid state. Manual fixes to the Document may be necessary,
   * resolving null images in {@link Texture Textures} or removing the affected
   * Textures, before the Document can be written to output or used in transforms.
   *
   * Defaults to true (strict mode).
   */
  setStrictResources(strict) {
    this._strictResources = strict;
    return this;
  }
  /**********************************************************************************************
   * Public Read API.
   */
  /** Reads a {@link Document} from the given URI. */
  async read(uri) {
    return await this.readJSON(await this.readAsJSON(uri));
  }
  /** Loads a URI and returns a {@link JSONDocument} struct, without parsing. */
  async readAsJSON(uri) {
    const view = await this.readURI(uri, "view");
    this.lastReadBytes = view.byteLength;
    const jsonDoc = isGLB(view) ? this._binaryToJSON(view) : {
      json: JSON.parse(BufferUtils.decodeText(view)),
      resources: {}
    };
    await this._readResourcesExternal(jsonDoc, this.dirname(uri));
    this._readResourcesInternal(jsonDoc);
    return jsonDoc;
  }
  /** Converts glTF-formatted JSON and a resource map to a {@link Document}. */
  async readJSON(jsonDoc) {
    jsonDoc = this._copyJSON(jsonDoc);
    this._readResourcesInternal(jsonDoc);
    return GLTFReader.read(jsonDoc, {
      extensions: Array.from(this._extensions),
      dependencies: this._dependencies,
      logger: this._logger
    });
  }
  /** Converts a GLB-formatted Uint8Array to a {@link JSONDocument}. */
  async binaryToJSON(glb) {
    const jsonDoc = this._binaryToJSON(BufferUtils.assertView(glb));
    this._readResourcesInternal(jsonDoc);
    const json = jsonDoc.json;
    if (json.buffers && json.buffers.some((bufferDef) => isExternalBuffer(jsonDoc, bufferDef))) {
      throw new Error("Cannot resolve external buffers with binaryToJSON().");
    } else if (json.images && json.images.some((imageDef) => isExternalImage(jsonDoc, imageDef))) {
      throw new Error("Cannot resolve external images with binaryToJSON().");
    }
    return jsonDoc;
  }
  /** Converts a GLB-formatted Uint8Array to a {@link Document}. */
  async readBinary(glb) {
    return this.readJSON(await this.binaryToJSON(BufferUtils.assertView(glb)));
  }
  /**********************************************************************************************
   * Public Write API.
   */
  /** Converts a {@link Document} to glTF-formatted JSON and a resource map. */
  async writeJSON(doc, _options = {}) {
    if (_options.format === Format.GLB && doc.getRoot().listBuffers().length > 1) {
      throw new Error("GLB must have 0–1 buffers.");
    }
    return GLTFWriter.write(doc, {
      format: _options.format || Format.GLTF,
      basename: _options.basename || "",
      logger: this._logger,
      vertexLayout: this._vertexLayout,
      dependencies: _extends({}, this._dependencies),
      extensions: Array.from(this._extensions)
    });
  }
  /** Converts a {@link Document} to a GLB-formatted Uint8Array. */
  async writeBinary(doc) {
    const {
      json,
      resources
    } = await this.writeJSON(doc, {
      format: Format.GLB
    });
    const header = new Uint32Array([1179937895, 2, 12]);
    const jsonText = JSON.stringify(json);
    const jsonChunkData = BufferUtils.pad(BufferUtils.encodeText(jsonText), 32);
    const jsonChunkHeader = BufferUtils.toView(new Uint32Array([jsonChunkData.byteLength, 1313821514]));
    const jsonChunk = BufferUtils.concat([jsonChunkHeader, jsonChunkData]);
    header[header.length - 1] += jsonChunk.byteLength;
    const binBuffer = Object.values(resources)[0];
    if (!binBuffer || !binBuffer.byteLength) {
      return BufferUtils.concat([BufferUtils.toView(header), jsonChunk]);
    }
    const binChunkData = BufferUtils.pad(binBuffer, 0);
    const binChunkHeader = BufferUtils.toView(new Uint32Array([binChunkData.byteLength, 5130562]));
    const binChunk = BufferUtils.concat([binChunkHeader, binChunkData]);
    header[header.length - 1] += binChunk.byteLength;
    return BufferUtils.concat([BufferUtils.toView(header), jsonChunk, binChunk]);
  }
  /**********************************************************************************************
   * Internal.
   */
  async _readResourcesExternal(jsonDoc, base) {
    var _this = this;
    const images = jsonDoc.json.images || [];
    const buffers = jsonDoc.json.buffers || [];
    const pendingResources = [...images, ...buffers].map(async function(resource) {
      const uri = resource.uri;
      if (!uri || uri.match(/data:/)) return Promise.resolve();
      try {
        jsonDoc.resources[uri] = await _this.readURI(_this.resolve(base, uri), "view");
        _this.lastReadBytes += jsonDoc.resources[uri].byteLength;
      } catch (error) {
        if (!_this._strictResources && images.includes(resource)) {
          _this._logger.warn(`Failed to load image URI, "${uri}". ${error}`);
          jsonDoc.resources[uri] = null;
        } else {
          throw error;
        }
      }
    });
    await Promise.all(pendingResources);
  }
  _readResourcesInternal(jsonDoc) {
    function resolveResource(resource) {
      if (!resource.uri) return;
      if (resource.uri in jsonDoc.resources) {
        BufferUtils.assertView(jsonDoc.resources[resource.uri]);
        return;
      }
      if (resource.uri.match(/data:/)) {
        const resourceUUID = `__${uuid()}.${FileUtils.extension(resource.uri)}`;
        jsonDoc.resources[resourceUUID] = BufferUtils.createBufferFromDataURI(resource.uri);
        resource.uri = resourceUUID;
      }
    }
    const images = jsonDoc.json.images || [];
    images.forEach((image) => {
      if (image.bufferView === void 0 && image.uri === void 0) {
        throw new Error("Missing resource URI or buffer view.");
      }
      resolveResource(image);
    });
    const buffers = jsonDoc.json.buffers || [];
    buffers.forEach(resolveResource);
  }
  /**
   * Creates a shallow copy of glTF-formatted {@link JSONDocument}.
   *
   * Images, Buffers, and Resources objects are deep copies so that PlatformIO can safely
   * modify them during the parsing process. Other properties are shallow copies, and buffers
   * are passed by reference.
   */
  _copyJSON(jsonDoc) {
    const {
      images,
      buffers
    } = jsonDoc.json;
    jsonDoc = {
      json: _extends({}, jsonDoc.json),
      resources: _extends({}, jsonDoc.resources)
    };
    if (images) {
      jsonDoc.json.images = images.map((image) => _extends({}, image));
    }
    if (buffers) {
      jsonDoc.json.buffers = buffers.map((buffer) => _extends({}, buffer));
    }
    return jsonDoc;
  }
  /** Internal version of binaryToJSON; does not warn about external resources. */
  _binaryToJSON(glb) {
    if (!isGLB(glb)) {
      throw new Error("Invalid glTF 2.0 binary.");
    }
    const jsonChunkHeader = new Uint32Array(glb.buffer, glb.byteOffset + 12, 2);
    if (jsonChunkHeader[1] !== ChunkType.JSON) {
      throw new Error("Missing required GLB JSON chunk.");
    }
    const jsonByteOffset = 20;
    const jsonByteLength = jsonChunkHeader[0];
    const jsonText = BufferUtils.decodeText(BufferUtils.toView(glb, jsonByteOffset, jsonByteLength));
    const json = JSON.parse(jsonText);
    const binByteOffset = jsonByteOffset + jsonByteLength;
    if (glb.byteLength <= binByteOffset) {
      return {
        json,
        resources: {}
      };
    }
    const binChunkHeader = new Uint32Array(glb.buffer, glb.byteOffset + binByteOffset, 2);
    if (binChunkHeader[1] !== ChunkType.BIN) {
      return {
        json,
        resources: {}
      };
    }
    const binByteLength = binChunkHeader[0];
    const binBuffer = BufferUtils.toView(glb, binByteOffset + 8, binByteLength);
    return {
      json,
      resources: {
        [GLB_BUFFER]: binBuffer
      }
    };
  }
}
function isExternalBuffer(jsonDocument, bufferDef) {
  return bufferDef.uri !== void 0 && !(bufferDef.uri in jsonDocument.resources);
}
function isExternalImage(jsonDocument, imageDef) {
  return imageDef.uri !== void 0 && !(imageDef.uri in jsonDocument.resources) && imageDef.bufferView === void 0;
}
function isGLB(view) {
  if (view.byteLength < 3 * Uint32Array.BYTES_PER_ELEMENT) return false;
  const header = new Uint32Array(view.buffer, view.byteOffset, 3);
  return header[0] === 1179937895 && header[1] === 2;
}
class NodeIO extends PlatformIO {
  /**
   * Constructs a new NodeIO service. Instances are reusable. By default, only NodeIO can only
   * read/write paths on disk. To enable HTTP requests, provide a Fetch API implementation and
   * enable {@link NodeIO.setAllowNetwork setAllowNetwork}.
   *
   * @param fetch Implementation of Fetch API.
   * @param fetchConfig Configuration object for Fetch API.
   */
  constructor(_fetch = null, _fetchConfig = HTTPUtils.DEFAULT_INIT) {
    super();
    this._fetch = void 0;
    this._fetchConfig = void 0;
    this._init = void 0;
    this._fetchEnabled = false;
    this._fetch = _fetch;
    this._fetchConfig = _fetchConfig;
    this._init = this.init();
  }
  async init() {
    if (this._init) return this._init;
    return Promise.all([import("fs"), import("path")]).then(([fs2, path2]) => {
      this._fs = fs2.promises;
      this._path = path2;
    });
  }
  setAllowNetwork(allow) {
    if (allow && !this._fetch) {
      throw new Error("NodeIO requires a Fetch API implementation for HTTP requests.");
    }
    this._fetchEnabled = allow;
    return this;
  }
  async readURI(uri, type) {
    await this.init();
    if (HTTPUtils.isAbsoluteURL(uri)) {
      if (!this._fetchEnabled || !this._fetch) {
        throw new Error("Network request blocked. Allow HTTP requests explicitly, if needed.");
      }
      const response = await this._fetch(uri, this._fetchConfig);
      switch (type) {
        case "view":
          return new Uint8Array(await response.arrayBuffer());
        case "text":
          return response.text();
      }
    } else {
      switch (type) {
        case "view":
          return this._fs.readFile(uri);
        case "text":
          return this._fs.readFile(uri, "utf8");
      }
    }
  }
  resolve(base, path2) {
    if (HTTPUtils.isAbsoluteURL(base) || HTTPUtils.isAbsoluteURL(path2)) {
      return HTTPUtils.resolve(base, path2);
    }
    return this._path.resolve(base, decodeURIComponent(path2));
  }
  dirname(uri) {
    if (HTTPUtils.isAbsoluteURL(uri)) {
      return HTTPUtils.dirname(uri);
    }
    return this._path.dirname(uri);
  }
  /**********************************************************************************************
   * Public.
   */
  /** Writes a {@link Document} instance to a local path. */
  async write(uri, doc) {
    await this.init();
    const isGLB2 = !!uri.match(/\.glb$/);
    await (isGLB2 ? this._writeGLB(uri, doc) : this._writeGLTF(uri, doc));
  }
  /**********************************************************************************************
   * Private.
   */
  /** @internal */
  async _writeGLTF(uri, doc) {
    var _this = this;
    this.lastWriteBytes = 0;
    const {
      json,
      resources
    } = await this.writeJSON(doc, {
      format: Format.GLTF,
      basename: FileUtils.basename(uri)
    });
    const {
      _fs: fs2,
      _path: path2
    } = this;
    const dir = path2.dirname(uri);
    const jsonContent = JSON.stringify(json, null, 2);
    await fs2.writeFile(uri, jsonContent);
    this.lastWriteBytes += jsonContent.length;
    for (const batch of listBatches(Object.keys(resources), 10)) {
      await Promise.all(batch.map(async function(resourceURI) {
        if (HTTPUtils.isAbsoluteURL(resourceURI)) {
          if (HTTPUtils.extension(resourceURI) === "bin") {
            throw new Error(`Cannot write buffer to path "${resourceURI}".`);
          }
          return;
        }
        const resourcePath = path2.join(dir, decodeURIComponent(resourceURI));
        await fs2.mkdir(path2.dirname(resourcePath), {
          recursive: true
        });
        await fs2.writeFile(resourcePath, resources[resourceURI]);
        _this.lastWriteBytes += resources[resourceURI].byteLength;
      }));
    }
  }
  /** @internal */
  async _writeGLB(uri, doc) {
    const buffer = await this.writeBinary(doc);
    await this._fs.writeFile(uri, buffer);
    this.lastWriteBytes = buffer.byteLength;
  }
}
function listBatches(array, batchSize) {
  const batches = [];
  for (let i = 0, il = array.length; i < il; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < il; j++) {
      batch.push(array[i + j]);
    }
    batches.push(batch);
  }
  return batches;
}
class GltfModelParser {
  async parse(filePath) {
    const io = new NodeIO();
    const doc = await io.read(filePath);
    const root = doc.getRoot();
    const materials = [];
    const materialMap = /* @__PURE__ */ new Map();
    const dir = path.dirname(filePath);
    for (const mat of root.listMaterials()) {
      const idx = materials.length;
      materialMap.set(mat, idx);
      const baseColorFactor = mat.getBaseColorFactor();
      const baseColorTex = mat.getBaseColorTexture();
      const normalTex = mat.getNormalTexture();
      let diffusePath = null;
      let normalPath = null;
      if (baseColorTex) {
        const image = baseColorTex.getImage();
        if (image) {
          const texName = baseColorTex.getName() || `texture_${idx}_diff`;
          const ext = baseColorTex.getMimeType() === "image/png" ? ".png" : ".jpg";
          diffusePath = path.join(dir, `${texName}${ext}`);
          fs.writeFileSync(diffusePath, Buffer.from(image));
        }
      }
      if (normalTex) {
        const image = normalTex.getImage();
        if (image) {
          const texName = normalTex.getName() || `texture_${idx}_norm`;
          const ext = normalTex.getMimeType() === "image/png" ? ".png" : ".jpg";
          normalPath = path.join(dir, `${texName}${ext}`);
          fs.writeFileSync(normalPath, Buffer.from(image));
        }
      }
      materials.push({
        name: mat.getName() || `material_${idx}`,
        diffuseTexturePath: diffusePath,
        normalTexturePath: normalPath,
        specularTexturePath: null,
        diffuseColor: {
          x: baseColorFactor[0],
          y: baseColorFactor[1],
          z: baseColorFactor[2],
          w: baseColorFactor[3]
        },
        shaderName: normalPath ? "normal.sps" : "default.sps"
      });
    }
    if (materials.length === 0) {
      materials.push({
        name: "default",
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: "default.sps"
      });
    }
    const geometries = [];
    for (const mesh2 of root.listMeshes()) {
      for (const prim of mesh2.listPrimitives()) {
        const posAccessor = prim.getAttribute("POSITION");
        const normAccessor = prim.getAttribute("NORMAL");
        const uvAccessor = prim.getAttribute("TEXCOORD_0");
        const idxAccessor = prim.getIndices();
        if (!posAccessor) continue;
        const positions = posAccessor.getArray();
        const normals = normAccessor?.getArray();
        const uvs = uvAccessor?.getArray();
        const rawIndices = idxAccessor?.getArray();
        if (!positions) continue;
        const vertexCount = posAccessor.getCount();
        const vertices = [];
        for (let i = 0; i < vertexCount; i++) {
          vertices.push({
            position: {
              x: positions[i * 3],
              y: positions[i * 3 + 1],
              z: positions[i * 3 + 2]
            },
            normal: normals ? {
              x: normals[i * 3],
              y: normals[i * 3 + 1],
              z: normals[i * 3 + 2]
            } : { x: 0, y: 0, z: 0 },
            texCoord: uvs ? {
              u: uvs[i * 2],
              v: 1 - uvs[i * 2 + 1]
              // Flip V for GTA
            } : { u: 0, v: 0 }
          });
        }
        let indices;
        if (rawIndices) {
          indices = Array.from(rawIndices);
        } else {
          indices = Array.from({ length: vertexCount }, (_, i) => i);
        }
        const mat = prim.getMaterial();
        const matIdx = mat ? materialMap.get(mat) ?? 0 : 0;
        geometries.push({
          materialIndex: matIdx,
          vertices,
          indices
        });
      }
    }
    const mesh = {
      name: path.basename(filePath, path.extname(filePath)),
      geometries,
      materials,
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0 }
    };
    return normalizeMesh(mesh);
  }
}
function findNodes(root, name) {
  const results = [];
  for (const node of root) {
    if (node.name === name) results.push(node);
    if (node.nodes) results.push(...findNodes(node.nodes, name));
  }
  return results;
}
function findNode(nodes, name) {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.nodes) {
      const found = findNode(node.nodes, name);
      if (found) return found;
    }
  }
  return void 0;
}
class FbxModelParser {
  async parse(filePath) {
    const buffer = fs.readFileSync(filePath);
    let fbxTree;
    const header = buffer.slice(0, 20).toString("ascii");
    if (header.startsWith("Kaydara FBX Binary")) {
      fbxTree = fbxParser.parseBinary(buffer);
    } else {
      fbxTree = fbxParser.parseText(buffer.toString("utf-8"));
    }
    const dir = path.dirname(filePath);
    const geometryNodes = findNodes(fbxTree, "Geometry");
    const materials = [];
    const geometries = [];
    const connectionNode = findNode(fbxTree, "Connections");
    const connections = [];
    if (connectionNode?.nodes) {
      for (const c of connectionNode.nodes) {
        if (c.name === "C" && c.props.length >= 3) {
          connections.push({
            child: Number(c.props[1]),
            parent: Number(c.props[2])
          });
        }
      }
    }
    const materialNodes = findNodes(fbxTree, "Material");
    const materialIdMap = /* @__PURE__ */ new Map();
    for (const matNode of materialNodes) {
      const matId = Number(matNode.props[0] || 0);
      const matName = String(matNode.props[1] || `material_${materials.length}`).replace(/\x00.*/, "");
      const idx = materials.length;
      materialIdMap.set(matId, idx);
      materials.push({
        name: matName,
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: "default.sps"
      });
    }
    const textureNodes = findNodes(fbxTree, "Texture");
    for (const texNode of textureNodes) {
      const texId = Number(texNode.props[0] || 0);
      const fileNameNode = findNode(texNode.nodes, "FileName") || findNode(texNode.nodes, "RelativeFilename");
      if (!fileNameNode) continue;
      const texPath = String(fileNameNode.props[0] || "");
      const resolvedPath = path.isAbsolute(texPath) ? texPath : path.resolve(dir, texPath);
      for (const conn of connections) {
        if (conn.child === texId) {
          const matIdx = materialIdMap.get(conn.parent);
          if (matIdx !== void 0 && fs.existsSync(resolvedPath)) {
            materials[matIdx].diffuseTexturePath = resolvedPath;
          }
        }
      }
    }
    if (materials.length === 0) {
      materials.push({
        name: "default",
        diffuseTexturePath: null,
        normalTexturePath: null,
        specularTexturePath: null,
        diffuseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1 },
        shaderName: "default.sps"
      });
    }
    for (const geoNode of geometryNodes) {
      const geoId = Number(geoNode.props[0] || 0);
      const verticesNode = findNode(geoNode.nodes, "Vertices");
      const indicesNode = findNode(geoNode.nodes, "PolygonVertexIndex");
      if (!verticesNode || !indicesNode) continue;
      const rawVerts = verticesNode.props[0];
      const rawIndices = indicesNode.props[0];
      if (!rawVerts || !rawIndices) continue;
      let rawNormals = null;
      const normalLayer = findNode(geoNode.nodes, "LayerElementNormal");
      if (normalLayer) {
        const normNode = findNode(normalLayer.nodes, "Normals");
        if (normNode) rawNormals = normNode.props[0];
      }
      let rawUVs = null;
      let uvIndices = null;
      const uvLayer = findNode(geoNode.nodes, "LayerElementUV");
      if (uvLayer) {
        const uvNode = findNode(uvLayer.nodes, "UV");
        const uvIdxNode = findNode(uvLayer.nodes, "UVIndex");
        if (uvNode) rawUVs = uvNode.props[0];
        if (uvIdxNode) uvIndices = uvIdxNode.props[0];
      }
      const vertices = [];
      const indices = [];
      const vertexMap = /* @__PURE__ */ new Map();
      const polygon = [];
      let normalIdx = 0;
      for (let i = 0; i < rawIndices.length; i++) {
        let vi = rawIndices[i];
        const isEnd = vi < 0;
        if (isEnd) vi = ~vi;
        polygon.push(vi);
        if (isEnd) {
          for (let t = 1; t < polygon.length - 1; t++) {
            const triVerts = [polygon[0], polygon[t], polygon[t + 1]];
            const triNormIndices = [
              normalIdx,
              normalIdx + t,
              normalIdx + t + 1
            ];
            for (let tv = 0; tv < 3; tv++) {
              const pvi = triVerts[tv];
              const ni = triNormIndices[tv];
              const uvIdx = uvIndices ? uvIndices[i - polygon.length + 1 + (tv === 0 ? 0 : tv === 1 ? t : t + 1)] : ni;
              const key = `${pvi}/${ni}/${uvIdx}`;
              let idx = vertexMap.get(key);
              if (idx === void 0) {
                const px = rawVerts[pvi * 3] || 0;
                const py = rawVerts[pvi * 3 + 1] || 0;
                const pz = rawVerts[pvi * 3 + 2] || 0;
                let nx = 0, ny = 0, nz = 0;
                if (rawNormals && ni * 3 + 2 < rawNormals.length) {
                  nx = rawNormals[ni * 3];
                  ny = rawNormals[ni * 3 + 1];
                  nz = rawNormals[ni * 3 + 2];
                }
                let u = 0, v = 0;
                if (rawUVs && uvIdx >= 0 && uvIdx * 2 + 1 < rawUVs.length) {
                  u = rawUVs[uvIdx * 2];
                  v = 1 - rawUVs[uvIdx * 2 + 1];
                }
                idx = vertices.length;
                vertices.push({
                  position: { x: px, y: py, z: pz },
                  normal: { x: nx, y: ny, z: nz },
                  texCoord: { u, v }
                });
                vertexMap.set(key, idx);
              }
              indices.push(idx);
            }
          }
          normalIdx += polygon.length;
          polygon.length = 0;
        }
      }
      let matIdx = 0;
      for (const conn of connections) {
        if (conn.parent === geoId) {
          const mi = materialIdMap.get(conn.child);
          if (mi !== void 0) {
            matIdx = mi;
            break;
          }
        }
      }
      if (vertices.length > 0 && indices.length > 0) {
        geometries.push({
          materialIndex: matIdx,
          vertices,
          indices
        });
      }
    }
    const mesh = {
      name: path.basename(filePath, path.extname(filePath)),
      geometries,
      materials,
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
      boundingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 0 }
    };
    return normalizeMesh(mesh);
  }
}
const execFileAsync$2 = util.promisify(child_process.execFile);
const BLENDER_PATHS_WIN = [
  "C:\\Program Files\\Blender Foundation",
  "C:\\Program Files (x86)\\Blender Foundation"
];
let cachedPath = null;
async function detectBlender() {
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  try {
    const { stdout } = await execFileAsync$2("where", ["blender"], { timeout: 5e3 });
    const found = stdout.trim().split("\n")[0]?.trim();
    if (found && fs.existsSync(found)) {
      cachedPath = found;
      return found;
    }
  } catch {
  }
  for (const basePath of BLENDER_PATHS_WIN) {
    if (!fs.existsSync(basePath)) continue;
    try {
      const dirs = fs.readdirSync(basePath).sort().reverse();
      for (const dir of dirs) {
        const blenderExe = path.join(basePath, dir, "blender.exe");
        if (fs.existsSync(blenderExe)) {
          cachedPath = blenderExe;
          return blenderExe;
        }
      }
    } catch {
    }
  }
  return null;
}
function getNativePath(relativePath) {
  if (utils.is.dev) {
    return path.join(electron.app.getAppPath(), "native", relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
}
const execFileAsync$1 = util.promisify(child_process.execFile);
class BlendHandler {
  async parse(filePath) {
    const blenderPath = await detectBlender();
    if (!blenderPath) {
      throw new Error(
        "Blender not found. Please install Blender to convert .blend files, or export your model as .fbx, .obj, or .glb from Blender first."
      );
    }
    const tempDir = path.join(os.tmpdir(), `b2fivem_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const outputGlb = path.join(tempDir, "export.glb");
    const scriptPath = getNativePath("blender-scripts/export_to_gltf.py");
    try {
      await execFileAsync$1(blenderPath, [
        "--background",
        filePath,
        "--python",
        scriptPath,
        "--",
        outputGlb
      ], {
        timeout: 12e4
        // 2 minute timeout
      });
      if (!fs.existsSync(outputGlb)) {
        throw new Error("Blender export failed: no output file generated");
      }
      const gltfParser = new GltfModelParser();
      const mesh = await gltfParser.parse(outputGlb);
      mesh.name = path.basename(filePath, ".blend");
      return mesh;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
      }
    }
  }
}
const PARSERS = {
  ".obj": () => new ObjModelParser(),
  ".gltf": () => new GltfModelParser(),
  ".glb": () => new GltfModelParser(),
  ".fbx": () => new FbxModelParser(),
  ".blend": () => new BlendHandler()
};
function createParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const factory = PARSERS[ext];
  if (!factory) {
    throw new Error(`Unsupported file format: ${ext}. Supported: ${Object.keys(PARSERS).join(", ")}`);
  }
  return factory();
}
const SHADER_DEFS = {
  "default.sps": {
    fileName: "default.sps",
    renderBucket: 0,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "HardAlphaBlend", type: "Vector", value: [0, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  },
  "normal.sps": {
    fileName: "normal.sps",
    renderBucket: 0,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "BumpSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "HardAlphaBlend", type: "Vector", value: [0, 0, 0, 0] },
      { name: "bumpiness", type: "Vector", value: [1, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  },
  "normal_spec.sps": {
    fileName: "normal_spec.sps",
    renderBucket: 0,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "BumpSampler", type: "Texture" },
      { name: "SpecSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "HardAlphaBlend", type: "Vector", value: [0, 0, 0, 0] },
      { name: "bumpiness", type: "Vector", value: [1, 0, 0, 0] },
      { name: "specularIntensityMult", type: "Vector", value: [0.5, 0, 0, 0] },
      { name: "specularFalloffMult", type: "Vector", value: [50, 0, 0, 0] },
      { name: "specularFresnel", type: "Vector", value: [0.97, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  },
  "spec.sps": {
    fileName: "spec.sps",
    renderBucket: 0,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "SpecSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "HardAlphaBlend", type: "Vector", value: [0, 0, 0, 0] },
      { name: "specularIntensityMult", type: "Vector", value: [0.5, 0, 0, 0] },
      { name: "specularFalloffMult", type: "Vector", value: [50, 0, 0, 0] },
      { name: "specularFresnel", type: "Vector", value: [0.97, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  },
  "emissive.sps": {
    fileName: "emissive.sps",
    renderBucket: 1,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "EmissiveMultiplier", type: "Vector", value: [1, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  },
  "cutout.sps": {
    fileName: "cutout.sps",
    renderBucket: 1,
    params: [
      { name: "DiffuseSampler", type: "Texture" },
      { name: "matMaterialColorScale", type: "Vector", value: [1, 0, 0, 1] },
      { name: "HardAlphaBlend", type: "Vector", value: [1, 0, 0, 0] },
      { name: "useTessellation", type: "Vector", value: [0, 0, 0, 0] }
    ]
  }
};
function getShaderDef(name) {
  return SHADER_DEFS[name] || SHADER_DEFS["default.sps"];
}
function esc$1(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function vec3(x, y, z) {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`;
}
function generateDrawableXml(mesh, config) {
  const bb = mesh.boundingBox;
  const bs = mesh.boundingSphere;
  const propName = config.propName;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<Drawable>");
  lines.push(`  <Name>${esc$1(propName)}</Name>`);
  lines.push(`  <BoundingSphereCenter ${vec3(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`  <BoundingSphereRadius value="${bs.radius.toFixed(8)}" />`);
  lines.push(`  <BoundingBoxMin ${vec3(bb.min.x, bb.min.y, bb.min.z)} />`);
  lines.push(`  <BoundingBoxMax ${vec3(bb.max.x, bb.max.y, bb.max.z)} />`);
  lines.push(`  <LodDistHigh value="${config.lodDistHigh.toFixed(8)}" />`);
  lines.push(`  <LodDistMed value="${config.lodDistMed.toFixed(8)}" />`);
  lines.push(`  <LodDistLow value="${config.lodDistLow.toFixed(8)}" />`);
  lines.push(`  <LodDistVlow value="${config.lodDistVlow.toFixed(8)}" />`);
  lines.push(`  <FlagsHigh value="0" />`);
  lines.push(`  <FlagsMed value="0" />`);
  lines.push(`  <FlagsLow value="0" />`);
  lines.push(`  <FlagsVlow value="0" />`);
  lines.push("  <ShaderGroup>");
  lines.push("    <TextureDictionary />");
  lines.push("    <Shaders>");
  for (let i = 0; i < mesh.materials.length; i++) {
    const mat = mesh.materials[i];
    const shaderName = config.shaderName || mat.shaderName || "default.sps";
    const shaderDef = getShaderDef(shaderName);
    lines.push("      <Item>");
    lines.push(`        <Name>${esc$1(mat.name)}</Name>`);
    lines.push(`        <FileName>${esc$1(shaderDef.fileName)}</FileName>`);
    lines.push(`        <RenderBucket value="${shaderDef.renderBucket}" />`);
    lines.push("        <Parameters>");
    for (const param of shaderDef.params) {
      if (param.type === "Texture") {
        let texName = `${propName}_diff`;
        if (param.name === "BumpSampler") texName = `${propName}_n`;
        else if (param.name === "SpecSampler") texName = `${propName}_s`;
        lines.push(`          <Item name="${param.name}" type="Texture">`);
        lines.push(`            <Name>${esc$1(texName)}</Name>`);
        lines.push(`          </Item>`);
      } else if (param.type === "Vector" && param.value) {
        lines.push(`          <Item name="${param.name}" type="Vector">`);
        lines.push(`            <Value x="${param.value[0]}" y="${param.value[1]}" z="${param.value[2]}" w="${param.value[3]}" />`);
        lines.push(`          </Item>`);
      }
    }
    lines.push("        </Parameters>");
    lines.push("      </Item>");
  }
  lines.push("    </Shaders>");
  lines.push("  </ShaderGroup>");
  lines.push("  <DrawableModelsHigh>");
  for (let gi = 0; gi < mesh.geometries.length; gi++) {
    const geo = mesh.geometries[gi];
    if (geo.vertices.length === 0 || geo.indices.length === 0) continue;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of geo.vertices) {
      minX = Math.min(minX, v.position.x);
      minY = Math.min(minY, v.position.y);
      minZ = Math.min(minZ, v.position.z);
      maxX = Math.max(maxX, v.position.x);
      maxY = Math.max(maxY, v.position.y);
      maxZ = Math.max(maxZ, v.position.z);
    }
    lines.push("    <Item>");
    lines.push('      <RenderMask value="255" />');
    lines.push("      <Geometries>");
    lines.push("        <Item>");
    lines.push(`          <ShaderIndex value="${geo.materialIndex}" />`);
    lines.push(`          <BoundingBoxMin ${vec3(minX, minY, minZ)} />`);
    lines.push(`          <BoundingBoxMax ${vec3(maxX, maxY, maxZ)} />`);
    lines.push("          <VertexBuffer>");
    lines.push('            <Flags value="0" />');
    lines.push('            <Layout type="GTAV1">');
    lines.push("              <Position />");
    lines.push("              <Normal />");
    lines.push("              <Colour0 />");
    lines.push("              <TexCoord0 />");
    lines.push("            </Layout>");
    lines.push(`            <Count value="${geo.vertices.length}" />`);
    lines.push("            <Data>");
    for (const v of geo.vertices) {
      const px = v.position.x.toFixed(8);
      const py = v.position.y.toFixed(8);
      const pz = v.position.z.toFixed(8);
      const nx = v.normal.x.toFixed(8);
      const ny = v.normal.y.toFixed(8);
      const nz = v.normal.z.toFixed(8);
      const cr = v.color ? v.color.x : 255;
      const cg = v.color ? v.color.y : 255;
      const cb = v.color ? v.color.z : 255;
      const ca = v.color ? v.color.w : 255;
      const tu = v.texCoord.u.toFixed(8);
      const tv = v.texCoord.v.toFixed(8);
      lines.push(`              ${px} ${py} ${pz}   ${nx} ${ny} ${nz}   ${cr} ${cg} ${cb} ${ca}   ${tu} ${tv}`);
    }
    lines.push("            </Data>");
    lines.push("          </VertexBuffer>");
    lines.push("          <IndexBuffer>");
    lines.push(`            <Count value="${geo.indices.length}" />`);
    lines.push("            <Data>");
    for (let i = 0; i < geo.indices.length; i += 3) {
      const a = geo.indices[i];
      const b = geo.indices[i + 1];
      const c = geo.indices[i + 2];
      lines.push(`              ${a} ${b} ${c}`);
    }
    lines.push("            </Data>");
    lines.push("          </IndexBuffer>");
    lines.push("        </Item>");
    lines.push("      </Geometries>");
    lines.push("    </Item>");
  }
  lines.push("  </DrawableModelsHigh>");
  lines.push("</Drawable>");
  return lines.join("\n");
}
function generateTextureDictXml(propName, textures) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<TextureDictionary>");
  lines.push("  <Textures>");
  for (const tex of textures) {
    lines.push("    <Item>");
    lines.push(`      <Name>${tex.name}</Name>`);
    lines.push(`      <FileName>${tex.ddsFileName}</FileName>`);
    lines.push(`      <Width value="${tex.width}" />`);
    lines.push(`      <Height value="${tex.height}" />`);
    lines.push(`      <MipLevels value="${tex.mipLevels}" />`);
    lines.push(`      <Format>${tex.format}</Format>`);
    lines.push(`      <Usage>DIFFUSE</Usage>`);
    lines.push("    </Item>");
  }
  lines.push("  </Textures>");
  lines.push("</TextureDictionary>");
  return lines.join("\n");
}
function generatePlaceholderTextureDictXml(propName) {
  return generateTextureDictXml(propName, [{
    name: `${propName}_diff`,
    ddsFileName: `${propName}_diff.dds`,
    width: 64,
    height: 64,
    mipLevels: 7,
    format: "D3DFMT_DXT1"
  }]);
}
function vec3Attr$1(x, y, z) {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`;
}
function generateBoundsXml(mesh, collisionType) {
  const bb = mesh.boundingBox;
  const bs = mesh.boundingSphere;
  switch (collisionType) {
    case "bbox":
      return generateBBoxXml(bb, bs);
    case "convex":
      return generateConvexHullXml(mesh, bb, bs);
    case "mesh":
      return generateTriangleMeshXml(mesh, bb, bs);
    default:
      return generateBBoxXml(bb, bs);
  }
}
function generateBBoxXml(bb, bs) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<Bounds>");
  lines.push("  <Type>Box</Type>");
  lines.push(`  <BoxCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`  <BoxSize ${vec3Attr$1(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z)} />`);
  lines.push(`  <SphereCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`);
  lines.push(`  <BoundingBoxMin ${vec3Attr$1(bb.min.x, bb.min.y, bb.min.z)} />`);
  lines.push(`  <BoundingBoxMax ${vec3Attr$1(bb.max.x, bb.max.y, bb.max.z)} />`);
  lines.push(`  <BoundingBoxCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push('  <Margin value="0.04000000" />');
  lines.push('  <MaterialIndex value="0" />');
  lines.push('  <MaterialColourIndex value="0" />');
  lines.push('  <ProceduralId value="0" />');
  lines.push("</Bounds>");
  return lines.join("\n");
}
function generateConvexHullXml(mesh, bb, bs) {
  const allPositions = [];
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      allPositions.push(v.position);
    }
  }
  const hullPoints = [
    { x: bb.min.x, y: bb.min.y, z: bb.min.z },
    { x: bb.max.x, y: bb.min.y, z: bb.min.z },
    { x: bb.min.x, y: bb.max.y, z: bb.min.z },
    { x: bb.max.x, y: bb.max.y, z: bb.min.z },
    { x: bb.min.x, y: bb.min.y, z: bb.max.z },
    { x: bb.max.x, y: bb.min.y, z: bb.max.z },
    { x: bb.min.x, y: bb.max.y, z: bb.max.z },
    { x: bb.max.x, y: bb.max.y, z: bb.max.z }
  ];
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<Bounds>");
  lines.push("  <Type>Geometry</Type>");
  lines.push(`  <SphereCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`);
  lines.push(`  <BoundingBoxMin ${vec3Attr$1(bb.min.x, bb.min.y, bb.min.z)} />`);
  lines.push(`  <BoundingBoxMax ${vec3Attr$1(bb.max.x, bb.max.y, bb.max.z)} />`);
  lines.push(`  <BoundingBoxCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push('  <Margin value="0.04000000" />');
  lines.push('  <MaterialIndex value="0" />');
  lines.push('  <MaterialColourIndex value="0" />');
  lines.push("  <Vertices>");
  for (const p of hullPoints) {
    lines.push(`    <Item ${vec3Attr$1(p.x, p.y, p.z)} />`);
  }
  lines.push("  </Vertices>");
  lines.push("  <Polygons>");
  const boxTris = [
    [0, 1, 3],
    [0, 3, 2],
    // bottom
    [4, 6, 7],
    [4, 7, 5],
    // top
    [0, 4, 5],
    [0, 5, 1],
    // front
    [2, 3, 7],
    [2, 7, 6],
    // back
    [0, 2, 6],
    [0, 6, 4],
    // left
    [1, 5, 7],
    [1, 7, 3]
    // right
  ];
  for (const tri of boxTris) {
    lines.push(`    <Item v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" materialIndex="0" />`);
  }
  lines.push("  </Polygons>");
  lines.push("</Bounds>");
  return lines.join("\n");
}
function generateTriangleMeshXml(mesh, bb, bs) {
  const allVerts = [];
  const allIndices = [];
  let vertexOffset = 0;
  for (const geo of mesh.geometries) {
    for (const v of geo.vertices) {
      allVerts.push(v.position);
    }
    for (let i = 0; i < geo.indices.length; i += 3) {
      allIndices.push([
        geo.indices[i] + vertexOffset,
        geo.indices[i + 1] + vertexOffset,
        geo.indices[i + 2] + vertexOffset
      ]);
    }
    vertexOffset += geo.vertices.length;
  }
  const maxTris = 1e3;
  let triStep = 1;
  if (allIndices.length > maxTris) {
    triStep = Math.ceil(allIndices.length / maxTris);
  }
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<Bounds>");
  lines.push("  <Type>GeometryBVH</Type>");
  lines.push(`  <SphereCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`  <SphereRadius value="${bs.radius.toFixed(8)}" />`);
  lines.push(`  <BoundingBoxMin ${vec3Attr$1(bb.min.x, bb.min.y, bb.min.z)} />`);
  lines.push(`  <BoundingBoxMax ${vec3Attr$1(bb.max.x, bb.max.y, bb.max.z)} />`);
  lines.push(`  <BoundingBoxCenter ${vec3Attr$1(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push('  <Margin value="0.04000000" />');
  lines.push('  <MaterialIndex value="0" />');
  lines.push('  <MaterialColourIndex value="0" />');
  lines.push("  <Vertices>");
  for (const v of allVerts) {
    lines.push(`    <Item ${vec3Attr$1(v.x, v.y, v.z)} />`);
  }
  lines.push("  </Vertices>");
  lines.push("  <Polygons>");
  for (let i = 0; i < allIndices.length; i += triStep) {
    const tri = allIndices[i];
    lines.push(`    <Item v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" materialIndex="0" />`);
  }
  lines.push("  </Polygons>");
  lines.push("</Bounds>");
  return lines.join("\n");
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function vec3Attr(x, y, z) {
  return `x="${x.toFixed(8)}" y="${y.toFixed(8)}" z="${z.toFixed(8)}"`;
}
function generateYtypXml(mesh, config) {
  const bb = mesh.boundingBox;
  const bs = mesh.boundingSphere;
  const propName = config.propName;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<CMapTypes>");
  lines.push("  <extensions />");
  lines.push("  <archetypes>");
  lines.push('    <Item type="CBaseArchetypeDef">');
  lines.push(`      <lodDist value="${config.lodDistHigh.toFixed(8)}" />`);
  lines.push('      <flags value="32" />');
  lines.push('      <specialAttribute value="0" />');
  lines.push(`      <bbMin ${vec3Attr(bb.min.x, bb.min.y, bb.min.z)} />`);
  lines.push(`      <bbMax ${vec3Attr(bb.max.x, bb.max.y, bb.max.z)} />`);
  lines.push(`      <bsCentre ${vec3Attr(bs.center.x, bs.center.y, bs.center.z)} />`);
  lines.push(`      <bsRadius value="${bs.radius.toFixed(8)}" />`);
  lines.push('      <hdTextureDist value="15.00000000" />');
  lines.push(`      <name>${esc(propName)}</name>`);
  lines.push(`      <textureDictionary>${esc(propName)}</textureDictionary>`);
  lines.push("      <clipDictionary />");
  lines.push("      <drawableDictionary />");
  lines.push(`      <physicsDictionary>${esc(propName)}</physicsDictionary>`);
  lines.push("      <assetType>ASSET_TYPE_DRAWABLE</assetType>");
  lines.push(`      <assetName>${esc(propName)}</assetName>`);
  lines.push("      <extensions />");
  lines.push("    </Item>");
  lines.push("  </archetypes>");
  lines.push(`  <name>${esc(propName)}</name>`);
  lines.push("  <dependencies />");
  lines.push("  <compositeEntityTypes />");
  lines.push("</CMapTypes>");
  return lines.join("\n");
}
const execFileAsync = util.promisify(child_process.execFile);
let texconvAvailable = null;
async function checkTexconv() {
  if (texconvAvailable !== null) return texconvAvailable;
  const texconvPath = getNativePath("texconv/texconv.exe");
  texconvAvailable = fs.existsSync(texconvPath);
  return texconvAvailable;
}
async function convertToDDS(inputPath, outputDir, options) {
  const hasTexconv = await checkTexconv();
  if (!hasTexconv) {
    console.warn("texconv.exe not found, using fallback DDS generation");
    return fallbackConvert(inputPath, outputDir, options);
  }
  const texconvPath = getNativePath("texconv/texconv.exe");
  const outputName = options.outputName || path.basename(inputPath, path.extname(inputPath));
  const args = [
    "-f",
    options.format,
    "-m",
    String(options.mipLevels),
    "-w",
    String(options.maxWidth),
    "-h",
    String(options.maxHeight),
    "-o",
    outputDir,
    "-y",
    // overwrite existing
    "-sepalpha",
    // preserve alpha
    inputPath
  ];
  try {
    await execFileAsync(texconvPath, args, { timeout: 6e4 });
  } catch (err) {
    console.error("texconv failed:", err);
    return fallbackConvert(inputPath, outputDir, options);
  }
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const generatedPath = path.join(outputDir, `${baseName}.dds`);
  const finalPath = path.join(outputDir, `${outputName}.dds`);
  if (generatedPath !== finalPath && fs.existsSync(generatedPath)) {
    fs.renameSync(generatedPath, finalPath);
  }
  return finalPath;
}
async function fallbackConvert(inputPath, outputDir, options) {
  const outputName = options.outputName || path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDir, `${outputName}.dds`);
  const width = 64;
  const height = 64;
  const headerSize = 128;
  const dataSize = width * height / 2;
  const buffer = Buffer.alloc(headerSize + dataSize);
  buffer.write("DDS ", 0);
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(659463, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(dataSize, 20);
  buffer.writeUInt32LE(1, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(4, 80);
  buffer.write("DXT1", 84);
  buffer.writeUInt32LE(4096, 108);
  for (let i = headerSize; i < buffer.length; i += 8) {
    buffer.writeUInt16LE(65535, i);
    buffer.writeUInt16LE(65535, i + 2);
    buffer.writeUInt32LE(0, i + 4);
  }
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}
const QUALITY_PRESETS = {
  high: { format: "BC7_UNORM", formatName: "D3DFMT_A8B8G8R8", maxSize: 1024, mipLevels: 11 },
  medium: { format: "BC3_UNORM", formatName: "D3DFMT_DXT5", maxSize: 512, mipLevels: 10 },
  low: { format: "BC1_UNORM", formatName: "D3DFMT_DXT1", maxSize: 256, mipLevels: 9 }
};
async function processTextures(materials, propName, quality, tempDir) {
  const preset = QUALITY_PRESETS[quality];
  const textures = [];
  const processedPaths = /* @__PURE__ */ new Set();
  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];
    const diffusePath = mat.diffuseTexturePath;
    if (diffusePath && fs.existsSync(diffusePath) && !processedPaths.has(diffusePath)) {
      processedPaths.add(diffusePath);
      const texName = `${propName}_diff`;
      try {
        const ddsPath = await convertToDDS(diffusePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        });
        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        });
      } catch (err) {
        console.warn(`Failed to convert texture ${diffusePath}:`, err);
        textures.push(createPlaceholderEntry(texName));
      }
    } else if (!diffusePath || !fs.existsSync(diffusePath || "")) {
      const texName = `${propName}_diff`;
      if (!textures.some((t) => t.name === texName)) {
        await createPlaceholderDDS(texName, tempDir);
        textures.push(createPlaceholderEntry(texName));
      }
    }
    if (mat.normalTexturePath && fs.existsSync(mat.normalTexturePath) && !processedPaths.has(mat.normalTexturePath)) {
      processedPaths.add(mat.normalTexturePath);
      const texName = `${propName}_n`;
      try {
        const ddsPath = await convertToDDS(mat.normalTexturePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        });
        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        });
      } catch (err) {
        console.warn(`Failed to convert normal map:`, err);
      }
    }
    if (mat.specularTexturePath && fs.existsSync(mat.specularTexturePath) && !processedPaths.has(mat.specularTexturePath)) {
      processedPaths.add(mat.specularTexturePath);
      const texName = `${propName}_s`;
      try {
        const ddsPath = await convertToDDS(mat.specularTexturePath, tempDir, {
          format: preset.format,
          maxWidth: preset.maxSize,
          maxHeight: preset.maxSize,
          mipLevels: preset.mipLevels,
          outputName: texName
        });
        textures.push({
          name: texName,
          ddsFileName: path.basename(ddsPath),
          width: preset.maxSize,
          height: preset.maxSize,
          mipLevels: preset.mipLevels,
          format: preset.formatName
        });
      } catch (err) {
        console.warn(`Failed to convert specular map:`, err);
      }
    }
  }
  if (textures.length === 0) {
    const texName = `${propName}_diff`;
    await createPlaceholderDDS(texName, tempDir);
    textures.push(createPlaceholderEntry(texName));
  }
  return textures;
}
function createPlaceholderEntry(name, preset) {
  return {
    name,
    ddsFileName: `${name}.dds`,
    width: 64,
    height: 64,
    mipLevels: 7,
    format: "D3DFMT_DXT1"
  };
}
async function createPlaceholderDDS(name, outputDir, preset) {
  const width = 64;
  const height = 64;
  const headerSize = 128;
  const dataSize = width * height / 2;
  const buffer = Buffer.alloc(headerSize + dataSize);
  buffer.write("DDS ", 0);
  buffer.writeUInt32LE(124, 4);
  buffer.writeUInt32LE(659463, 8);
  buffer.writeUInt32LE(height, 12);
  buffer.writeUInt32LE(width, 16);
  buffer.writeUInt32LE(dataSize, 20);
  buffer.writeUInt32LE(1, 28);
  buffer.writeUInt32LE(32, 76);
  buffer.writeUInt32LE(4, 80);
  buffer.write("DXT1", 84);
  buffer.writeUInt32LE(4096, 108);
  for (let i = headerSize; i < buffer.length; i += 8) {
    buffer.writeUInt16LE(65535, i);
    buffer.writeUInt16LE(65535, i + 2);
    buffer.writeUInt32LE(0, i + 4);
  }
  const outPath = path.join(outputDir, `${name}.dds`);
  fs.writeFileSync(outPath, buffer);
}
function createRequest(type, params) {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    ...params
  };
}
class CodeWalkerBridge {
  static instance = null;
  process = null;
  readline = null;
  pending = /* @__PURE__ */ new Map();
  available = false;
  static getInstance() {
    if (!CodeWalkerBridge.instance) {
      CodeWalkerBridge.instance = new CodeWalkerBridge();
    }
    return CodeWalkerBridge.instance;
  }
  async start() {
    const exePath = getNativePath("codewalker-service/CodeWalkerService.exe");
    if (!fs.existsSync(exePath)) {
      console.warn(`CodeWalker service not found at ${exePath}`);
      this.available = false;
      return;
    }
    this.process = child_process.spawn(exePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.readline = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity
    });
    this.readline.on("line", (line) => {
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.success) {
            pending.resolve(response);
          } else {
            pending.reject(new Error(response.error || "Unknown error"));
          }
        }
      } catch {
      }
    });
    this.process.stderr?.on("data", (data) => {
      console.error("CodeWalker service error:", data.toString());
    });
    this.process.on("exit", (code) => {
      console.log(`CodeWalker service exited with code ${code}`);
      this.available = false;
      for (const [id, pending] of this.pending) {
        pending.reject(new Error("Service process exited"));
        this.pending.delete(id);
      }
    });
    try {
      await this.send(createRequest("health"));
      this.available = true;
    } catch {
      this.available = false;
    }
  }
  isAvailable() {
    return this.available;
  }
  async convertYdr(xmlPath, inputFolder, outputPath) {
    const response = await this.send(createRequest("convert_ydr", { xmlPath, inputFolder, outputPath }));
    return response.outputPath || outputPath;
  }
  async convertYtd(xmlPath, inputFolder, outputPath) {
    const response = await this.send(createRequest("convert_ytd", { xmlPath, inputFolder, outputPath }));
    return response.outputPath || outputPath;
  }
  async convertYbn(xmlPath, outputPath) {
    const response = await this.send(createRequest("convert_ybn", { xmlPath, outputPath }));
    return response.outputPath || outputPath;
  }
  async convertYtyp(xmlPath, outputPath) {
    const response = await this.send(createRequest("convert_ytyp", { xmlPath, outputPath }));
    return response.outputPath || outputPath;
  }
  send(request) {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("CodeWalker service is not running"));
        return;
      }
      this.pending.set(request.id, { resolve, reject });
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error("CodeWalker service request timed out"));
      }, 6e4);
      const originalResolve = this.pending.get(request.id).resolve;
      const originalReject = this.pending.get(request.id).reject;
      this.pending.set(request.id, {
        resolve: (r) => {
          clearTimeout(timeout);
          originalResolve(r);
        },
        reject: (e) => {
          clearTimeout(timeout);
          originalReject(e);
        }
      });
      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }
  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.readline = null;
    this.available = false;
    this.pending.clear();
  }
}
function generateFxManifest(propName) {
  return `fx_version 'cerulean'
game 'gta5'

description '${propName} - Custom prop generated by Blender to FiveM'

files {
    'stream/${propName}.ytyp'
}

data_file 'DLC_ITYP_REQUEST' 'stream/${propName}.ytyp'
`;
}
function packageResource(input) {
  const resourceDir = path.join(input.outputFolder, input.propName);
  const streamDir = path.join(resourceDir, "stream");
  fs.mkdirSync(streamDir, { recursive: true });
  const files = [];
  const manifest = generateFxManifest(input.propName);
  const manifestPath = path.join(resourceDir, "fxmanifest.lua");
  fs.writeFileSync(manifestPath, manifest, "utf-8");
  files.push({
    name: "fxmanifest.lua",
    size: Buffer.byteLength(manifest),
    path: manifestPath
  });
  const binaryFiles = [
    { src: input.ydrPath, name: `${input.propName}.ydr` },
    { src: input.ytdPath, name: `${input.propName}.ytd` },
    { src: input.ybnPath, name: `${input.propName}.ybn` },
    { src: input.ytypPath, name: `${input.propName}.ytyp` }
  ];
  for (const bf of binaryFiles) {
    if (bf.src && fs.existsSync(bf.src)) {
      const destPath = path.join(streamDir, bf.name);
      fs.copyFileSync(bf.src, destPath);
      const stat = fs.statSync(destPath);
      files.push({
        name: `stream/${bf.name}`,
        size: stat.size,
        path: destPath
      });
    }
  }
  const xmlFallbacks = [
    { src: input.ydrXmlPath, name: `${input.propName}.ydr.xml` },
    { src: input.ytdXmlPath, name: `${input.propName}.ytd.xml` },
    { src: input.ybnXmlPath, name: `${input.propName}.ybn.xml` },
    { src: input.ytypXmlPath, name: `${input.propName}.ytyp.xml` }
  ];
  const hasBinaryFiles = binaryFiles.some((bf) => bf.src && fs.existsSync(bf.src));
  if (!hasBinaryFiles) {
    for (const xf of xmlFallbacks) {
      if (fs.existsSync(xf.src)) {
        const destPath = path.join(streamDir, xf.name);
        fs.copyFileSync(xf.src, destPath);
        const stat = fs.statSync(destPath);
        files.push({
          name: `stream/${xf.name}`,
          size: stat.size,
          path: destPath
        });
      }
    }
    const ddsFiles = fs.readdirSync(input.tempDir).filter((f) => f.endsWith(".dds"));
    for (const ddsFile of ddsFiles) {
      const srcPath = path.join(input.tempDir, ddsFile);
      const destPath = path.join(streamDir, ddsFile);
      fs.copyFileSync(srcPath, destPath);
      const stat = fs.statSync(destPath);
      files.push({
        name: `stream/${ddsFile}`,
        size: stat.size,
        path: destPath
      });
    }
  }
  return { resourcePath: resourceDir, files };
}
async function exportAsZip(resourceDir) {
  const zipPath = `${resourceDir}.zip`;
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 9 } });
  return new Promise((resolve, reject) => {
    output.on("close", () => resolve(zipPath));
    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(resourceDir, path.basename(resourceDir));
    archive.finalize();
  });
}
const PREFIX = "b2fivem_";
function createTempDir() {
  const dir = path.join(os.tmpdir(), `${PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanTempDir(dir) {
  try {
    if (dir.includes(PREFIX)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
  }
}
async function runPipeline(config, onProgress, signal) {
  const tempDir = createTempDir();
  try {
    emitProgress(onProgress, 0, `Loading ${path.basename(config.inputFile)}...`);
    checkAbort(signal);
    const parser = createParser(config.inputFile);
    let mesh = await parser.parse(config.inputFile);
    mesh = normalizeMesh(mesh);
    emitProgress(onProgress, 0, `Parsed: ${countVertices(mesh)} vertices, ${countFaces(mesh)} faces`);
    emitProgress(onProgress, 1, "Converting textures to DDS...");
    checkAbort(signal);
    const textures = await processTextures(
      mesh.materials,
      config.propName,
      config.textureQuality,
      tempDir
    );
    emitProgress(onProgress, 1, `Processed ${textures.length} texture(s)`);
    emitProgress(onProgress, 2, "Generating drawable definition...");
    checkAbort(signal);
    const ydrXml = generateDrawableXml(mesh, config);
    const ydrXmlPath = path.join(tempDir, `${config.propName}.ydr.xml`);
    fs.writeFileSync(ydrXmlPath, ydrXml, "utf-8");
    const ytdXml = textures.length > 0 ? generateTextureDictXml(config.propName, textures) : generatePlaceholderTextureDictXml(config.propName);
    const ytdXmlPath = path.join(tempDir, `${config.propName}.ytd.xml`);
    fs.writeFileSync(ytdXmlPath, ytdXml, "utf-8");
    const ytypXml = generateYtypXml(mesh, config);
    const ytypXmlPath = path.join(tempDir, `${config.propName}.ytyp.xml`);
    fs.writeFileSync(ytypXmlPath, ytypXml, "utf-8");
    emitProgress(onProgress, 3, `Generating ${config.collisionType} collision...`);
    checkAbort(signal);
    const ybnXml = generateBoundsXml(mesh, config.collisionType);
    const ybnXmlPath = path.join(tempDir, `${config.propName}.ybn.xml`);
    fs.writeFileSync(ybnXmlPath, ybnXml, "utf-8");
    emitProgress(onProgress, 4, "Converting XML to GTA V binary format...");
    checkAbort(signal);
    let ydrBinaryPath;
    let ytdBinaryPath;
    let ybnBinaryPath;
    let ytypBinaryPath;
    const bridge = CodeWalkerBridge.getInstance();
    if (bridge.isAvailable()) {
      try {
        ydrBinaryPath = path.join(tempDir, `${config.propName}.ydr`);
        await bridge.convertYdr(ydrXmlPath, tempDir, ydrBinaryPath);
        ytdBinaryPath = path.join(tempDir, `${config.propName}.ytd`);
        await bridge.convertYtd(ytdXmlPath, tempDir, ytdBinaryPath);
        ybnBinaryPath = path.join(tempDir, `${config.propName}.ybn`);
        await bridge.convertYbn(ybnXmlPath, ybnBinaryPath);
        ytypBinaryPath = path.join(tempDir, `${config.propName}.ytyp`);
        await bridge.convertYtyp(ytypXmlPath, ytypBinaryPath);
        emitProgress(onProgress, 4, "Binary conversion complete");
      } catch (err) {
        console.error("CodeWalker conversion error:", err);
        emitProgress(onProgress, 4, "Binary conversion failed, using XML output. Convert manually with CodeWalker.");
        ydrBinaryPath = void 0;
        ytdBinaryPath = void 0;
        ybnBinaryPath = void 0;
        ytypBinaryPath = void 0;
      }
    } else {
      emitProgress(onProgress, 4, "CodeWalker not available - XML files will be exported for manual conversion");
    }
    emitProgress(onProgress, 5, "Packaging FiveM resource...");
    checkAbort(signal);
    const outputFolder = config.outputFolder || path.join(
      process.env.USERPROFILE || process.env.HOME || ".",
      "Desktop"
    );
    const result = packageResource({
      propName: config.propName,
      outputFolder,
      tempDir,
      ydrPath: ydrBinaryPath,
      ytdPath: ytdBinaryPath,
      ybnPath: ybnBinaryPath,
      ytypPath: ytypBinaryPath,
      ydrXmlPath,
      ytdXmlPath,
      ybnXmlPath,
      ytypXmlPath
    });
    if (config.generateZip) {
      await exportAsZip(result.resourcePath);
    }
    emitProgress(onProgress, 5, "Resource packaged successfully!");
    return {
      success: true,
      resourcePath: result.resourcePath,
      files: result.files
    };
  } finally {
    cleanTempDir(tempDir);
  }
}
function checkAbort(signal) {
  if (signal?.aborted) {
    throw new Error("Conversion cancelled");
  }
}
function countVertices(mesh) {
  return mesh.geometries.reduce((sum, g) => sum + g.vertices.length, 0);
}
function countFaces(mesh) {
  return mesh.geometries.reduce((sum, g) => sum + Math.floor(g.indices.length / 3), 0);
}
let currentAbortController = null;
function registerIpcHandlers() {
  electron.ipcMain.handle("dialog:select-output", async () => {
    const window = electron.BrowserWindow.getFocusedWindow();
    if (!window) return null;
    const result = await electron.dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "Select Output Folder"
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("dialog:select-file", async () => {
    const window = electron.BrowserWindow.getFocusedWindow();
    if (!window) return null;
    const result = await electron.dialog.showOpenDialog(window, {
      properties: ["openFile"],
      title: "Select 3D Model",
      filters: [
        { name: "3D Models", extensions: ["fbx", "obj", "blend", "glb", "gltf"] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("app:get-blender-path", async () => {
    return detectBlender();
  });
  electron.ipcMain.handle("convert:start", async (event, config) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("No window found");
    currentAbortController = new AbortController();
    try {
      const result = await runPipeline(config, (progress) => {
        window.webContents.send("convert:progress", progress);
      }, currentAbortController.signal);
      window.webContents.send("convert:complete", result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      window.webContents.send("convert:error", { message: error });
      throw err;
    } finally {
      currentAbortController = null;
    }
  });
  electron.ipcMain.handle("convert:cancel", () => {
    currentAbortController?.abort();
    currentAbortController = null;
  });
  electron.ipcMain.handle("shell:open-folder", async (_event, folderPath) => {
    const { shell } = await import("electron");
    shell.openPath(folderPath);
  });
}
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f0f0f",
    title: "Blender to FiveM",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.blendertofivem.converter");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  registerIpcHandlers();
  createWindow();
  CodeWalkerBridge.getInstance().start().catch((err) => {
    console.warn("CodeWalker service not available:", err.message);
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  CodeWalkerBridge.getInstance().stop();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
