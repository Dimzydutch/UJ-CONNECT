const { GOODS_CATEGORIES, SERVICES_CATEGORIES } = require('./categoryData');

/**
 * Inserts every main category and subcategory from categoryData.js if it
 * doesn't already exist. Safe to run repeatedly — existing rows are left
 * untouched (matched by name), so this can be called on every fresh
 * install and every migration run without creating duplicates.
 */
async function seedCategories(pool) {
  let categoriesAdded = 0;
  let subcategoriesAdded = 0;

  const groups = [
    { type: 'goods', list: GOODS_CATEGORIES },
    { type: 'services', list: SERVICES_CATEGORIES }
  ];

  for (const group of groups) {
    for (const cat of group.list) {
      let categoryId;
      const [existing] = await pool.query('SELECT id FROM categories WHERE name = ?', [cat.name]);

      if (existing.length > 0) {
        categoryId = existing[0].id;
      } else {
        const [result] = await pool.query(
          'INSERT INTO categories (name, type, icon) VALUES (?, ?, ?)',
          [cat.name, group.type, cat.icon || 'tag']
        );
        categoryId = result.insertId;
        categoriesAdded++;
      }

      for (const subName of cat.subcategories) {
        const [existingSub] = await pool.query(
          'SELECT id FROM subcategories WHERE category_id = ? AND name = ?',
          [categoryId, subName]
        );
        if (existingSub.length === 0) {
          await pool.query(
            'INSERT INTO subcategories (category_id, name) VALUES (?, ?)',
            [categoryId, subName]
          );
          subcategoriesAdded++;
        }
      }
    }
  }

  return { categoriesAdded, subcategoriesAdded };
}

module.exports = seedCategories;
