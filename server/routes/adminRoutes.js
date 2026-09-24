const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { verifyToken, requireAdmin } = require('../middleware/auth');

// All admin routes require valid token + admin role
router.use(verifyToken, requireAdmin);

router.get('/stats', adminController.getDashboardStats);

router.get('/listings', adminController.getAllListings);
router.patch('/listings/:id/status', adminController.updateListingStatus);

router.get('/users', adminController.getAllUsers);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.delete('/users/:id', adminController.deleteUser);

router.post('/categories', adminController.createCategory);
router.delete('/categories/:id', adminController.deleteCategory);
router.post('/subcategories', adminController.createSubcategory);
router.delete('/subcategories/:id', adminController.deleteSubcategory);

router.get('/reports', adminController.getAllReports);
router.patch('/reports/:id/resolve', adminController.resolveReport);

module.exports = router;
