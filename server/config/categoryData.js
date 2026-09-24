/**
 * The full category taxonomy for UJ Connect. Each top-level entry is a
 * main category shown in the "Category" dropdown; its subcategories array
 * populates the second, dependent "Subcategory" dropdown once a main
 * category is chosen.
 *
 * This is the single source of truth — both initDb.js (fresh installs)
 * and migrateCategories.js (existing installs) seed from this file, so
 * updating the taxonomy only ever needs to happen here.
 */

const GOODS_CATEGORIES = [
  { name: 'Electronics & Gadgets', icon: 'cpu', subcategories: ['Phones', 'Laptops & Computers', 'Tablets', 'Headphones & Earbuds', 'Chargers & Cables', 'Power Banks', 'Smartwatches', 'Speakers', 'Accessories'] },
  { name: 'Fashion & Clothing', icon: 'shirt', subcategories: ["Men's Clothing", "Women's Clothing", 'Shoes', 'Bags', 'Watches', 'Jewelry & Accessories', 'Native Wear', 'Sportswear'] },
  { name: 'Food & Drinks', icon: 'utensils', subcategories: ['Cooked Meals', 'Snacks', 'Pastries', 'Drinks & Beverages', 'Fruits', 'Cakes', 'Food Ingredients'] },
  { name: 'Beauty & Personal Care', icon: 'sparkles', subcategories: ['Skincare', 'Hair Products', 'Wigs & Extensions', 'Perfumes', 'Makeup', 'Barbershop/Salon Products'] },
  { name: 'Books & Educational Materials', icon: 'book', subcategories: ['Textbooks', 'Novels', 'Lecture Notes', 'Past Questions', 'Handouts', 'Study Materials', 'Stationery'] },
  { name: 'Furniture and Materials', icon: 'armchair', subcategories: ['Furniture', 'Mattresses', 'Chairs & Tables', 'Kitchen Items', 'Bedding', 'Curtains', 'Cleaning Supplies', 'Decorations'] },
  { name: 'Sports & Fitness', icon: 'dumbbell', subcategories: ['Jerseys', 'Football Boots', 'Sports Shoes', 'Gym Equipment', 'Sports Accessories'] },
  { name: 'Automotive', icon: 'car', subcategories: ['Cars', 'Motorcycles', 'Spare Parts', 'Car Accessories', 'Helmets'] },
  { name: 'Gaming', icon: 'gamepad', subcategories: ['PlayStation', 'Xbox', 'Nintendo', 'Games', 'Controllers', 'Gaming Accessories'] },
  { name: 'Musical Instruments', icon: 'music', subcategories: ['Keyboards', 'Guitars', 'Drums', 'Microphones', 'Audio Equipment'] },
  { name: 'Agriculture', icon: 'leaf', subcategories: ['Farm Produce', 'Seeds', 'Farm Equipment', 'Livestock', 'Agricultural Products'] },
  { name: 'Other / Miscellaneous', icon: 'grid', subcategories: ['Other'] }
];

const SERVICES_CATEGORIES = [
  { name: 'Technology & Digital Services', icon: 'cpu', subcategories: ['Web Development', 'App Development', 'Graphic Design', 'UI/UX Design', 'Software Installation', 'Computer Repairs', 'Data Analysis', 'IT Support'] },
  { name: 'Photography & Videography', icon: 'camera', subcategories: ['Event Photography', 'Portrait Photography', 'Video Coverage', 'Photo Editing', 'Video Editing'] },
  { name: 'Creative & Design', icon: 'palette', subcategories: ['Logo Design', 'Flyers', 'Posters', 'Branding', 'Illustration', 'Printing'] },
  { name: 'Beauty & Grooming Services', icon: 'scissors', subcategories: ['Hairdressing', 'Barbering', 'Makeup', 'Nail Services', 'Fashion/Styling'] },
  { name: 'Fashion Services', icon: 'shirt', subcategories: ['Tailoring', 'Clothing Alteration', 'Shoe Making/Repair', 'Laundry & Dry Cleaning'] },
  { name: 'Food & Catering Services', icon: 'utensils', subcategories: ['Catering', 'Meal Preparation', 'Baking', 'Small Chops', 'Event Food Services'] },
  { name: 'Repairs & Maintenance', icon: 'tool', subcategories: ['Phone Repairs', 'Laptop Repairs', 'Electrical Repairs', 'Plumbing', 'Generator Repairs', 'Appliance Repairs'] },
  { name: 'Transportation & Logistics', icon: 'truck', subcategories: ['Delivery', 'Moving Services', 'Errand Services', 'Ride Services'] },
  { name: 'Event Services', icon: 'party', subcategories: ['Event Planning', 'Decoration', 'DJ Services', 'MC Services', 'Sound & Lighting', 'Event Equipment Rental'] },
  { name: 'Academic Services', icon: 'graduation-cap', subcategories: ['Tutoring', 'Assignment Assistance', 'Research Assistance', 'Editing & Proofreading', 'Project Guidance', 'Exam Preparation'] },
  { name: 'Other Services', icon: 'grid', subcategories: ['Other'] }
];

module.exports = { GOODS_CATEGORIES, SERVICES_CATEGORIES };
