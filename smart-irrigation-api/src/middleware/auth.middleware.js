const jwt  = require('jsonwebtoken');
const User = require('../models/User.model');

/* protect — verify access token */
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'No token provided' });

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id);
    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'User not found or inactive' });

    // Atomic update — avoids VersionError from concurrent saves
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/* authorize — role guard */
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: `Role '${req.user.role}' is not allowed here` });
  next();
};

/* farmAccess — checks user is owner or member of req.params.farmId */
exports.farmAccess = (minRole) => async (req, res, next) => {
  const Farm = require('../models/Farm.model');
  const farm = await Farm.findById(req.params.farmId);
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  if (req.user.role === 'admin') { req.farm = farm; return next(); }
  if (!farm.hasMember(req.user._id))
    return res.status(403).json({ success: false, message: 'Not a member of this farm' });
  req.farm = farm;
  next();
};
/**
 * farmControl — comme farmAccess, mais pour les écritures.
 *
 * farmAccess laisse passer un membre invité en consultation, ce qui convient à
 * une lecture. Créer, modifier ou supprimer un équipement demande davantage :
 * seuls le propriétaire, un membre habilité et l'administrateur passent ici.
 */
exports.farmControl = () => async (req, res, next) => {
  const { canControlFarm } = require('../utils/scope');
  const farmId = req.params.farmId;
  if (!farmId) return res.status(400).json({ success: false, message: 'Farm is required' });
  if (!(await canControlFarm(req.user, farmId)))
    return res.status(403).json({ success: false, message: 'Lecture seule sur cette exploitation' });
  next();
};

/**
 * nodeAccess — périmètre pour les routes adressées par identifiant de nœud.
 *
 * Certaines routes ne passent pas par /farms/:farmId : /api/nodes/:nodeId/latest,
 * /history, /data. Elles n'avaient donc aucune garde, et un identifiant suffisait
 * à lire l'historique de mesures de n'importe quelle exploitation.
 *
 * Le refus renvoie 404 plutôt que 403 : à quelqu'un qui n'a pas accès, un nœud
 * qu'il n'a pas le droit de voir n'existe pas — et un 403 confirmerait qu'il
 * existe, ce qui rend l'énumération possible.
 */
exports.nodeAccess = ({ control = false } = {}) => async (req, res, next) => {
  const Node = require('../models/Node.model');
  const { canAccessFarm, canControlFarm } = require('../utils/scope');
  const id = req.params.nodeId;
  if (!id) return res.status(400).json({ success: false, message: 'Node is required' });

  const node = await Node.findById(id).select('farm').lean();
  if (!node) return res.status(404).json({ success: false, message: 'Node not found' });

  const ok = control
    ? await canControlFarm(req.user, node.farm)
    : await canAccessFarm(req.user, node.farm);
  if (!ok) {
    return control
      ? res.status(403).json({ success: false, message: 'Lecture seule sur cette exploitation' })
      : res.status(404).json({ success: false, message: 'Node not found' });
  }
  req.nodeFarm = node.farm;
  next();
};

/**
 * resourceAccess — périmètre pour toute ressource qui porte un champ `farm`.
 *
 * Programmes d'arrosage, règles d'alerte, commandes : elles sont adressées par
 * leur propre identifiant, hors de /farms/:farmId, et n'avaient donc aucune
 * garde. Une seule fabrique évite d'en réécrire une par modèle — et surtout
 * d'en oublier une.
 *
 *   resourceAccess(() => require('../models/Schedule.model'), 'id', { control: true })
 *
 * Le modèle est passé paresseusement : ce fichier est chargé très tôt, et
 * exiger les modèles au sommet créerait des cycles d'import.
 */
exports.resourceAccess = (getModel, param = 'id', { control = false } = {}) => async (req, res, next) => {
  const { canAccessFarm, canControlFarm } = require('../utils/scope');
  const Model = getModel();
  const id = req.params[param];
  if (!id) return res.status(400).json({ success: false, message: 'Missing identifier' });

  const doc = await Model.findById(id).select('farm').lean();
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

  const ok = control
    ? await canControlFarm(req.user, doc.farm)
    : await canAccessFarm(req.user, doc.farm);
  if (!ok) {
    // Lecture refusée : 404, pour ne pas confirmer l'existence de la ressource.
    return control
      ? res.status(403).json({ success: false, message: 'Lecture seule sur cette exploitation' })
      : res.status(404).json({ success: false, message: 'Not found' });
  }
  next();
};
