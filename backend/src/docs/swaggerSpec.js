const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'QRDine API',
    version: '1.0.0',
    description: 'Swagger documentation for the QRDine backend API.',
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local development server',
    },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and current-user endpoints' },
    { name: 'Categories', description: 'Category management endpoints' },
    { name: 'Menu', description: 'Menu item management endpoints' },
    { name: 'Tables', description: 'Table management and QR endpoints' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Not authorized' },
        },
      },
      ValidationErrorResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Validation failed' },
          errors: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      DuplicateKeyResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Duplicate key error' },
          error: { type: 'object', additionalProperties: true },
        },
      },
      Cafe: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1b0a9a7d0c9a8f8d11111' },
          name: { type: 'string', example: 'Sunrise Cafe' },
          logo: { type: 'string', example: '' },
          address: { type: 'string', example: '123 Main Street' },
          phone: { type: 'string', example: '+1 555 0100' },
          email: { type: 'string', example: 'hello@sunrisecafe.com' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '64f1b0a9a7d0c9a8f8d22222' },
          cafeId: { type: 'string', example: '64f1b0a9a7d0c9a8f8d11111' },
          name: { type: 'string', example: 'Alice Owner' },
          email: { type: 'string', example: 'alice@sunrisecafe.com' },
          role: { type: 'string', enum: ['owner', 'manager', 'staff'], example: 'owner' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthTokenResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Login successful' },
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      RegisterOwnerResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Owner registration successful' },
          token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIs...' },
          user: { $ref: '#/components/schemas/User' },
          cafe: { $ref: '#/components/schemas/Cafe' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1b0a9a7d0c9a8f8d33333' },
          cafeId: { type: 'string', example: '64f1b0a9a7d0c9a8f8d11111' },
          name: { type: 'string', example: 'Breakfast' },
          displayOrder: { type: 'integer', example: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MenuItem: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1b0a9a7d0c9a8f8d44444' },
          cafeId: { type: 'string', example: '64f1b0a9a7d0c9a8f8d11111' },
          categoryId: { type: 'string', example: '64f1b0a9a7d0c9a8f8d33333' },
          name: { type: 'string', example: 'Pancakes' },
          description: { type: 'string', example: 'Fluffy pancakes with syrup' },
          image: { type: 'string', example: '' },
          price: { type: 'number', example: 8.5 },
          gstPercentage: { type: 'number', example: 5 },
          isAvailable: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Table: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f1b0a9a7d0c9a8f8d55555' },
          cafeId: { type: 'string', example: '64f1b0a9a7d0c9a8f8d11111' },
          tableNumber: { type: 'string', example: '12' },
          guestUrl: { type: 'string', example: 'https://qrdine.local/guest/64f1b0a9a7d0c9a8f8d55555' },
          qrCodeUrl: { type: 'string', example: '' },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CategoryListResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer', example: 2 },
          limit: { type: 'integer', example: 20 },
          categories: {
            type: 'array',
            items: { $ref: '#/components/schemas/Category' },
          },
        },
      },
      MenuListResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer', example: 3 },
          limit: { type: 'integer', example: 20 },
          menuItems: {
            type: 'array',
            items: { $ref: '#/components/schemas/MenuItem' },
          },
        },
      },
      TableListResponse: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 20 },
          totalCount: { type: 'integer', example: 12 },
          totalPages: { type: 'integer', example: 1 },
          count: { type: 'integer', example: 12 },
          tables: {
            type: 'array',
            items: { $ref: '#/components/schemas/Table' },
          },
        },
      },
    },
  },
  paths: {
    '/api/auth/register-owner': {
      post: {
        tags: ['Auth'],
        summary: 'Register an owner and create a cafe',
        description: 'Creates a cafe, creates the owner user, links the user to the cafe, and returns a JWT.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ownerName', 'ownerEmail', 'password', 'cafe'],
                properties: {
                  ownerName: { type: 'string', example: 'Alice Owner' },
                  ownerEmail: { type: 'string', format: 'email', example: 'alice@sunrisecafe.com' },
                  password: { type: 'string', example: 'Password123' },
                  cafe: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string', example: 'Sunrise Cafe' },
                      logo: { type: 'string', example: '' },
                      address: { type: 'string', example: '123 Main Street' },
                      phone: { type: 'string', example: '+1 555 0100' },
                      email: { type: 'string', format: 'email', example: 'hello@sunrisecafe.com' },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    ownerName: 'Alice Owner',
                    ownerEmail: 'alice@sunrisecafe.com',
                    password: 'Password123',
                    cafe: {
                      name: 'Sunrise Cafe',
                      logo: '',
                      address: '123 Main Street',
                      phone: '+1 555 0100',
                      email: 'hello@sunrisecafe.com',
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Owner registered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterOwnerResponse' },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
              },
            },
          },
          409: {
            description: 'Duplicate email or cafe conflict',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'alice@sunrisecafe.com' },
                  ownerEmail: { type: 'string', format: 'email', example: 'alice@sunrisecafe.com' },
                  password: { type: 'string', example: 'Password123' },
                },
                oneOf: [
                  { required: ['email', 'password'] },
                  { required: ['ownerEmail', 'password'] },
                ],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthTokenResponse' },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationErrorResponse' },
              },
            },
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get the authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Not authorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          500: {
            description: 'Server error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List categories for the current cafe',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 20 },
          },
        ],
        responses: {
          200: {
            description: 'Category list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CategoryListResponse' },
              },
            },
          },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
        },
      },
      post: {
        tags: ['Categories'],
        summary: 'Create a category',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', maxLength: 100, example: 'Breakfast' },
                  displayOrder: { type: 'integer', minimum: 0, example: 1 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Category created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Category created successfully' },
                    category: { $ref: '#/components/schemas/Category' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          409: { description: 'Duplicate category name for this cafe' },
        },
      },
    },
    '/api/categories/{id}': {
      put: {
        tags: ['Categories'],
        summary: 'Update a category',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', maxLength: 100, example: 'Lunch' },
                  displayOrder: { type: 'integer', minimum: 0, example: 2 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Category updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Category updated successfully' },
                    category: { $ref: '#/components/schemas/Category' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error or invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Category not found' },
          409: { description: 'Duplicate category name for this cafe' },
        },
      },
      delete: {
        tags: ['Categories'],
        summary: 'Delete a category',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Category deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Category deleted successfully' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Category not found' },
          409: { description: 'Category still has menu items' },
        },
      },
    },
    '/api/menu': {
      get: {
        tags: ['Menu'],
        summary: 'List menu items for the current cafe',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'categoryId', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'isAvailable', in: 'query', required: false, schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 20 } },
        ],
        responses: {
          200: {
            description: 'Menu item list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MenuListResponse' },
              },
            },
          },
          400: { description: 'Invalid query parameter' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
        },
      },
      post: {
        tags: ['Menu'],
        summary: 'Create a menu item',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['categoryId', 'name', 'price'],
                properties: {
                  categoryId: { type: 'string' },
                  name: { type: 'string', maxLength: 120, example: 'Pancakes' },
                  description: { type: 'string', maxLength: 500, example: 'Fluffy pancakes with syrup' },
                  price: { type: 'number', minimum: 0, example: 8.5 },
                  gstPercentage: { type: 'number', minimum: 0, maximum: 100, default: 0, example: 5 },
                  image: { type: 'string', example: '' },
                  isAvailable: { type: 'boolean', example: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Menu item created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Menu item created successfully' },
                    menuItem: { $ref: '#/components/schemas/MenuItem' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Category not found for this cafe' },
          409: { description: 'Duplicate menu item in category' },
        },
      },
    },
    '/api/menu/{id}': {
      put: {
        tags: ['Menu'],
        summary: 'Update a menu item',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  categoryId: { type: 'string' },
                  name: { type: 'string', maxLength: 120 },
                  description: { type: 'string', maxLength: 500 },
                  price: { type: 'number', minimum: 0 },
                  gstPercentage: { type: 'number', minimum: 0, maximum: 100 },
                  image: { type: 'string' },
                  isAvailable: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Menu item updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Menu item updated successfully' },
                    menuItem: { $ref: '#/components/schemas/MenuItem' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error or invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Menu item or category not found' },
          409: { description: 'Duplicate menu item in category' },
        },
      },
      delete: {
        tags: ['Menu'],
        summary: 'Delete a menu item',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Menu item deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Menu item deleted successfully' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Menu item not found' },
        },
      },
    },
    '/api/tables': {
      get: {
        tags: ['Tables'],
        summary: 'List tables for the current cafe',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 20 } },
          { name: 'isActive', in: 'query', required: false, schema: { type: 'boolean' } },
        ],
        responses: {
          200: {
            description: 'Table list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TableListResponse' },
              },
            },
          },
          400: { description: 'Invalid pagination or filter value' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
        },
      },
      post: {
        tags: ['Tables'],
        summary: 'Create a table and generate guest URL',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tableNumber'],
                properties: {
                  tableNumber: { type: 'string', example: '12' },
                  isActive: { type: 'boolean', example: true },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Table created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Table created successfully' },
                    table: { $ref: '#/components/schemas/Table' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          409: { description: 'Duplicate table number for this cafe' },
        },
      },
    },
    '/api/tables/{id}': {
      put: {
        tags: ['Tables'],
        summary: 'Update a table',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tableNumber'],
                properties: {
                  tableNumber: { type: 'string', example: '13' },
                  isActive: { type: 'boolean', example: false },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Table updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Table updated successfully' },
                    table: { $ref: '#/components/schemas/Table' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error or invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Table not found' },
          409: { description: 'Duplicate table number for this cafe' },
        },
      },
      delete: {
        tags: ['Tables'],
        summary: 'Soft disable a table',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Table disabled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Table disabled successfully' },
                    table: { $ref: '#/components/schemas/Table' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Table not found' },
        },
      },
    },
    '/api/tables/{id}/qr': {
      get: {
        tags: ['Tables'],
        summary: 'Get QR payload for a table',
        description: 'Generates a QR data URL dynamically from the stored guest URL.',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'QR payload generated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tableId: { type: 'string' },
                    tableNumber: { type: 'string' },
                    guestUrl: { type: 'string' },
                    qrDataUrl: { type: 'string', description: 'Base64 encoded QR image data URL' },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid id' },
          401: { description: 'Not authorized' },
          403: { description: 'Forbidden' },
          404: { description: 'Table not found' },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
