const router = require('express').Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const upload = require('../../middleware/upload');
const c = require('./product.controller');
const img = require('./product.images');

const canManage = [requireAuth, requireRole('owner', 'manager', 'inventory')];

router.get('/', c.list);
router.get('/:slug', c.getOne);
router.post('/', canManage, c.create);

router.post('/:id/images', canManage, upload.array('images', 8), img.add);
router.patch('/:id/images/cover', canManage, img.setCover);
router.delete('/:id/images', canManage, img.remove);

router.patch('/:id', canManage, c.update);
router.delete('/:id', canManage, c.archive);

module.exports = router;
